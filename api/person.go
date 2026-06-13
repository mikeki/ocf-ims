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

package api

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/mikeki/ocf-ims/directory"
	"github.com/mikeki/ocf-ims/lib/argon2id"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/conv"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
)

const (
	maxHandleLength = 64
	maxEmailLength  = 128
)

// dupEntryError is the MariaDB error number for a unique-constraint violation.
const dupEntryError = 1062

// validPersonStatuses are the PERSON.STATUS values IMS recognizes. Only 'active'
// people appear in the login directory and the attach-person autocompletes; the
// others are inactive/peripheral and are visible only on the admin People page.
var validPersonStatuses = map[string]bool{
	"active":             true,
	"alpha":              true,
	"auditor":            true,
	"inactive":           true,
	"inactive extension": true,
	"prospective":        true,
}

// CreatePerson adds a new person to the local directory. It is gated on
// GlobalAdministratePersonnel (the same delegatable permission as password reset),
// not on being an admin: onboarding people is personnel management, distinct from
// minting admins (see SetPersonAdmin). New people are created with status 'active';
// a password is optional (without one, the person can't log in until an admin sets
// one) and admin status is set separately via SetPersonAdmin.
type CreatePerson struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

type CreatePersonRequest struct {
	Handle string `json:"handle"`
	Email  string `json:"email"`
	// #nosec G117 // Exported secret field
	Password string `json:"password"`
	Onsite   bool   `json:"onsite"`
}

func (action CreatePerson) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.createPerson(req)
	if errHTTP != nil {
		errHTTP.From("[createPerson]").WriteResponse(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (action CreatePerson) createPerson(req *http.Request) *herr.HTTPError {
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	body, errHTTP := readBodyAs[CreatePersonRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}

	handle := strings.TrimSpace(body.Handle)
	if handle == "" {
		return herr.BadRequest("Handle is required", nil)
	}
	if len(handle) > maxHandleLength {
		return herr.BadRequest("Handle is too long", nil)
	}
	// HANDLE is nullable since 5e (registry people may have none); a login-capable
	// person created here always has one, so store it as a present value.
	handleNull := conv.StringToSql(&handle, maxHandleLength)

	email := strings.TrimSpace(body.Email)
	if len(email) > maxEmailLength {
		return herr.BadRequest("Email is too long", nil)
	}
	var emailNull sql.NullString
	if email != "" {
		emailNull = conv.StringToSql(&email, maxEmailLength)
	}

	// A password is optional, but if given it must satisfy the same bounds as the
	// reset endpoint (see postAuth re: the long-password hashing-exhaustion vector).
	var passwordNull sql.NullString
	if body.Password != "" {
		if len(body.Password) < minPasswordLength {
			return herr.BadRequest("Password must be at least 8 characters", nil)
		}
		if len(body.Password) > 256 {
			return herr.BadRequest("Outrageously long passwords are disallowed", ErrLongPassword)
		}
		hashed := argon2id.CreateHash(body.Password, argon2id.DefaultParams)
		passwordNull = conv.StringToSql(&hashed, 255)
	}

	// Friendly pre-check (the unique constraint is the backstop below, and also
	// catches a concurrent insert and the EMAIL uniqueness).
	_, err := action.imsDBQ.PersonByHandle(req.Context(), action.imsDBQ, handleNull)
	if err == nil {
		return herr.Conflict("A person with that handle already exists", nil)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return herr.InternalServerError("Failed to check handle", err).From("[PersonByHandle]")
	}

	err = action.imsDBQ.CreatePerson(req.Context(), action.imsDBQ, imsdb.CreatePersonParams{
		Handle:   handleNull,
		Email:    emailNull,
		Status:   "active",
		OnSite:   body.Onsite,
		Password: passwordNull,
		Created:  conv.TimeToFloat(time.Now()),
	})
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == dupEntryError {
			return herr.Conflict("That handle or email is already in use", nil)
		}
		return herr.InternalServerError("Failed to create person", err).From("[CreatePerson]")
	}

	// The directory is cached, so drop it to surface the new person immediately.
	action.userStore.InvalidateUsers()

	// #nosec G706 // log injection
	slog.Info("Created person", "handle", handle)
	return nil
}

// EditPerson updates a person's status and on-site flag. Gated on
// GlobalAdministratePersonnel like CreatePerson. The handle is immutable (it is
// the identifier in person: access expressions); the password and admin flag are
// changed via their own endpoints; email is set at creation only.
type EditPerson struct {
	imsDBQ    *store.DBQ
	userStore directory.UserStore
}

type EditPersonRequest struct {
	Status string `json:"status"`
	Onsite bool   `json:"onsite"`
}

func (action EditPerson) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	errHTTP := action.editPerson(req)
	if errHTTP != nil {
		errHTTP.From("[editPerson]").WriteResponse(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (action EditPerson) editPerson(req *http.Request) *herr.HTTPError {
	_, globalPermissions, errHTTP := getGlobalPermissions(req, action.imsDBQ, action.userStore)
	if errHTTP != nil {
		return errHTTP.From("[getGlobalPermissions]")
	}
	if globalPermissions&authz.GlobalAdministratePersonnel == 0 {
		return herr.Forbidden("The requestor does not have GlobalAdministratePersonnel permission", nil)
	}

	handle := req.PathValue("personHandle")
	if handle == "" {
		return herr.BadRequest("Empty person handle", nil)
	}

	body, errHTTP := readBodyAs[EditPersonRequest](req)
	if errHTTP != nil {
		return errHTTP.From("[readBodyAs]")
	}
	if !validPersonStatuses[body.Status] {
		return herr.BadRequest("Unknown status: "+body.Status, nil)
	}

	// Resolve the handle to a person (any status, so inactive people are editable).
	person, err := action.imsDBQ.PersonByHandle(req.Context(), action.imsDBQ, conv.StringToSql(&handle, maxHandleLength))
	if errors.Is(err, sql.ErrNoRows) {
		return herr.NotFound("Unknown person: "+handle, nil)
	}
	if err != nil {
		return herr.InternalServerError("Failed to look up person", err).From("[PersonByHandle]")
	}

	err = action.imsDBQ.EditPerson(req.Context(), action.imsDBQ, imsdb.EditPersonParams{
		Status: body.Status,
		OnSite: body.Onsite,
		ID:     person.ID,
	})
	if err != nil {
		return herr.InternalServerError("Failed to edit person", err).From("[EditPerson]")
	}

	action.userStore.InvalidateUsers()

	// #nosec G706 // log injection
	slog.Info("Edited person", "handle", handle, "status", body.Status, "onsite", body.Onsite)
	return nil
}
