//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

package person

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/directory"
	rpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/argon2id"
	"github.com/mikeki/ocf-ims/lib/attachment"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

// Service is the person domain's Connect surface: it holds the dependencies the person RPCs share
// so each RPC is a method rather than a free function with a long, per-call dependency list. It
// mirrors incident.Service (plan 09h/1c). api.ImsService composes one of these (built once in
// AddConnectToMux) and delegates to it. This slice adds the caller's own self-service RPCs
// (ChangeOwnPassword, UpdateOwnProfile, DeleteOwnProfilePicture); the admin personnel-management
// RPCs land as further methods on the same Service in a later slice. AttachmentsStore/S3Client are
// used only by the picture RPC; DefaultPassword only by the password change.
type Service struct {
	ImsDBQ           *store.DBQ
	UserStore        directory.UserStore
	DefaultPassword  string
	AttachmentsStore conf.AttachmentsStore
	S3Client         *attachment.S3Client
}

// ChangeOwnPassword is the domain method behind the ChangeOwnPassword RPC (plan 09h/1c). The REST
// POST /ims/api/auth/password endpoint was RETIRED with this extraction, not shimmed (migration
// decision, plan 09 §Migration strategy). It ports the REST setOwnPassword verbatim: the caller is
// already authenticated (so no current-password re-entry), the new password must clear the length
// floor/ceiling and must not be the shared default (the whole point is to get *off* it), the
// account must have an email (login matches email only), and the write marks the person off the
// default so GET /auth (GetAuthStatus) stops prompting. The identity is the JWT subject, never a
// request field, so a caller can only ever change their own credential.
func (s Service) ChangeOwnPassword(
	ctx context.Context,
	req *rpcv1.ChangeOwnPasswordRequest,
) (*rpcv1.ChangeOwnPasswordResponse, error) {
	password := req.GetPassword()
	if len(password) < minPasswordLength {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("password must be at least %d characters", minPasswordLength))
	}
	// See the note in postAuth: very long passwords are a hashing-exhaustion vector.
	if len(password) > 256 {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("outrageously long passwords are disallowed"))
	}
	// The whole point is to get OFF the shared default, so refuse to "change" to it.
	if s.DefaultPassword != "" && password == s.DefaultPassword {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("please choose a password other than the shared default"))
	}

	person, errConn := s.resolveSelf(ctx)
	if errConn != nil {
		return nil, errConn
	}
	// Login matches EMAIL only, so a password is useless without one. An access-holder always has
	// an email (they logged in), but guard anyway.
	if person.Email.String == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("your account has no email on file; ask an admin to add one"))
	}

	hashed := argon2id.CreateHash(password, argon2id.DefaultParams)
	// They just set a non-default password (the default was refused above), so mark them off the
	// default — GetAuthStatus won't prompt or re-verify them.
	err := s.ImsDBQ.SetPersonPassword(ctx, s.ImsDBQ, imsdb.SetPersonPasswordParams{
		Password:        conv.StringToSql(&hashed, 255),
		PasswordChanged: true,
		ID:              person.ID,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to set password: %w", err))
	}

	// Drop the cached directory so the new password is effective immediately (and the old/default
	// one stops working).
	s.UserStore.InvalidateUsers()
	slog.Info("Password changed by self", "person_id", person.ID)
	return &rpcv1.ChangeOwnPasswordResponse{}, nil
}

// UpdateOwnProfile is the domain method behind the UpdateOwnProfile RPC (plan 09h/1c). The REST
// POST /ims/api/auth/profile endpoint was RETIRED with this extraction (migration decision, plan
// 09 §Migration strategy). It ports the REST setOwnProfile verbatim: the caller edits their own
// identity/contact fields (resolved from the JWT), through the same shared applyProfileFields the
// admin EditPerson path uses — so the identity invariant, the "an account that can sign in must
// keep an email", the length caps, and the dup-entry 409 all hold identically. Participation and
// the admin flag are deliberately not editable here (they stay admin-only). Each proto field is
// optional, so an absent field leaves the stored value unchanged (present-but-empty clears).
func (s Service) UpdateOwnProfile(
	ctx context.Context,
	req *rpcv1.UpdateOwnProfileRequest,
) (*rpcv1.UpdateOwnProfileResponse, error) {
	person, errConn := s.resolveSelf(ctx)
	if errConn != nil {
		return nil, errConn
	}

	// applyProfileFields wants presence pointers (nil = leave the stored value unchanged), which is
	// exactly what the optional proto fields carry — so pass them straight through. They're gathered
	// in a composite literal (rather than req.GetHandle() etc.) precisely to preserve the *string
	// presence the getters would collapse to "".
	patch := struct{ handle, name, email, phone *string }{
		handle: req.Handle, name: req.Name, email: req.Email, phone: req.Phone,
	}
	errHTTP := applyProfileFields(ctx, s.ImsDBQ, person, patch.handle, patch.name, patch.email, patch.phone)
	if errHTTP != nil {
		return nil, server.HerrToConnect(errHTTP)
	}

	s.UserStore.InvalidateUsers()
	slog.Info("Profile edited by self", "person_id", person.ID)
	return &rpcv1.UpdateOwnProfileResponse{}, nil
}

// DeleteOwnProfilePicture is the domain method behind the DeleteOwnProfilePicture RPC (plan
// 09h/1c). The REST DELETE /ims/api/auth/picture endpoint was RETIRED with this extraction
// (migration decision, plan 09 §Migration strategy). It ports the REST deleteOwnProfilePicture
// verbatim: the caller removes their own picture (resolved from the JWT) through the shared
// clearProfilePicture (best-effort file delete after clearing the pointer). The picture *upload*
// (POST /auth/picture) is multipart/binary and stays plain HTTP (outside the proto contract, M8).
func (s Service) DeleteOwnProfilePicture(
	ctx context.Context,
	req *rpcv1.DeleteOwnProfilePictureRequest,
) (*rpcv1.DeleteOwnProfilePictureResponse, error) {
	person, errConn := s.resolveSelf(ctx)
	if errConn != nil {
		return nil, errConn
	}
	errHTTP := clearProfilePicture(ctx, s.AttachmentsStore, s.S3Client, s.ImsDBQ, person.ID, person.ProfilePicture.String)
	if errHTTP != nil {
		return nil, server.HerrToConnect(errHTTP)
	}
	return &rpcv1.DeleteOwnProfilePictureResponse{}, nil
}

// resolveSelf loads the caller's own PERSON row from the ctx claims the auth interceptor populated
// — the Connect-side analogue of the REST resolveSelf (which read the *http.Request JWT context).
// A missing claims context is Unauthenticated; a missing row is NotFound. The full row is returned
// so callers can read the stored email / picture pointer.
func (s Service) resolveSelf(ctx context.Context) (imsdb.PersonByIDRow, error) {
	claims, ok := server.ClaimsFromContext(ctx)
	if !ok {
		return imsdb.PersonByIDRow{}, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	person, err := s.ImsDBQ.PersonByID(ctx, s.ImsDBQ, claims.PersonID())
	if errors.Is(err, sql.ErrNoRows) {
		return imsdb.PersonByIDRow{}, connect.NewError(connect.CodeNotFound, errors.New("unknown person"))
	}
	if err != nil {
		return imsdb.PersonByIDRow{}, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to load person: %w", err))
	}
	return person, nil
}
