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

package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/api"
	"github.com/mikeki/ocf-ims/conf"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	"github.com/mikeki/ocf-ims/internal/server"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/store/actionlog"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"github.com/stretchr/testify/require"
)

// spyActionLogger captures the audit rows the action-log interceptor emits, so a
// test can assert the default-on read/write split without a database. It
// satisfies server.ActionLogger, which AddConnectToMux accepts.
type spyActionLogger struct {
	mu   sync.Mutex
	rows []imsdb.AddActionLogParams
}

func (s *spyActionLogger) Log(_ context.Context, record imsdb.AddActionLogParams) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rows = append(s.rows, record)
}

func (s *spyActionLogger) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.rows)
}

// newTestConnectClient stands up the real ImsService Connect handler — the same
// AddConnectToMux serve.go wires — on an httptest server, and returns a generated
// client pointed at it. This proves slice 1b end-to-end through the generated
// client (the Phase-1 gate's client path), with no database: the one implemented
// RPC (GetAuthStatus) is a NO_SIDE_EFFECTS read, so the action-log interceptor
// skips it, and the logger is constructed disabled as a belt-and-suspenders.
func newTestConnectClient(t *testing.T) (servicev1connect.ImsServiceClient, authz.JWTer) {
	t.Helper()
	// Disabled logger with a nil DBQ: Log() short-circuits before touching the
	// DB, so no MariaDB is needed for the spine proof.
	logger := actionlog.NewLogger(context.Background(), nil, false, false)
	return newTestConnectClientWithLogger(t, logger)
}

// newTestConnectClientWithLogger is newTestConnectClient with an injectable audit
// sink, so the action-log tests can watch what the interceptor records. userStore
// is nil: it is read only when auditing an authenticated mutation, which these
// tests never reach (the mutations here are called anonymously).
func newTestConnectClientWithLogger(t *testing.T, logger server.ActionLogger) (servicev1connect.ImsServiceClient, authz.JWTer) {
	t.Helper()
	cfg := conf.DefaultIMS()
	// imsDBQ is nil: the RPCs these tests exercise (GetAuthStatus, Login,
	// unauthenticated ListEvents) all answer before any DB access. Anything that
	// queries the DB is covered by the api/integration suite instead.
	mux := api.AddConnectToMux(http.NewServeMux(), cfg, nil, logger, nil)

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	client := servicev1connect.NewImsServiceClient(srv.Client(), srv.URL)
	return client, authz.JWTer{SecretKey: cfg.Core.JWTSecret}
}

// TestConnectGetAuthStatusAnonymous proves the transport and the auth interceptor:
// a call with no Bearer token reaches the handler with no claims in context, and
// GetAuthStatus answers authenticated=false rather than erroring.
func TestConnectGetAuthStatusAnonymous(t *testing.T) {
	t.Parallel()
	client, _ := newTestConnectClient(t)

	resp, err := client.GetAuthStatus(context.Background(),
		connect.NewRequest(&servicerpcv1.GetAuthStatusRequest{}))
	require.NoError(t, err)
	require.False(t, resp.Msg.GetAuthenticated())
	require.Empty(t, resp.Msg.GetUser())
}

// TestConnectGetAuthStatusAuthenticated proves the auth interceptor plumbs a
// valid Bearer token's claims into the handler's context, exactly as the REST
// OptionalAuthN adapter does — the identity subset comes straight back.
func TestConnectGetAuthStatusAuthenticated(t *testing.T) {
	t.Parallel()
	client, jwter := newTestConnectClient(t)

	token, err := jwter.CreateAccessToken("alice", 42, nil, true, nil, time.Now().Add(time.Hour))
	require.NoError(t, err)

	req := connect.NewRequest(&servicerpcv1.GetAuthStatusRequest{})
	req.Header().Set("Authorization", "Bearer "+token)
	resp, err := client.GetAuthStatus(context.Background(), req)
	require.NoError(t, err)
	require.True(t, resp.Msg.GetAuthenticated())
	require.Equal(t, "alice", resp.Msg.GetUser())
	require.Equal(t, int32(42), resp.Msg.GetPersonId())
	require.True(t, resp.Msg.GetAdmin())
}

// TestConnectProtovalidateRejects proves the protovalidate interceptor (M5): a
// Login with an empty email violates the min_len=1 constraint written into the
// proto and is rejected with CodeInvalidArgument. Login itself is still
// unimplemented in 1b — the interceptor runs before the handler, so validation is
// enforced independently of whether the method is wired (the 1a Step-0 finding).
func TestConnectProtovalidateRejects(t *testing.T) {
	t.Parallel()
	client, _ := newTestConnectClient(t)

	_, err := client.Login(context.Background(),
		connect.NewRequest(&servicerpcv1.LoginRequest{Email: "", Password: ""}))
	require.Error(t, err)
	require.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
}

// TestConnectUnimplementedPassesValidation proves the complement: a Login whose
// fields satisfy the constraints passes protovalidate and reaches the (still
// unimplemented) handler, returning CodeUnimplemented — confirming valid requests
// flow through the whole interceptor chain to the handler, and that the
// action-log interceptor tolerates a mutating RPC without panicking.
func TestConnectUnimplementedPassesValidation(t *testing.T) {
	t.Parallel()
	client, _ := newTestConnectClient(t)

	_, err := client.Login(context.Background(),
		connect.NewRequest(&servicerpcv1.LoginRequest{Email: "a@b.co", Password: "x"}))
	require.Error(t, err)
	require.Equal(t, connect.CodeUnimplemented, connect.CodeOf(err))
}

// TestConnectActionLogSkipsReads proves the action-log interceptor's default-on
// read/write split: GetAuthStatus is marked NO_SIDE_EFFECTS in the contract, so
// no audit row is written even though every RPC gets the interceptor. This runs
// through the real Connect handler, where the method's idempotency level reaches
// req.Spec() (unlike a hand-built request).
func TestConnectActionLogSkipsReads(t *testing.T) {
	t.Parallel()
	spy := &spyActionLogger{}
	client, _ := newTestConnectClientWithLogger(t, spy)

	_, err := client.GetAuthStatus(context.Background(),
		connect.NewRequest(&servicerpcv1.GetAuthStatusRequest{}))
	require.NoError(t, err)
	require.Zero(t, spy.count(), "a NO_SIDE_EFFECTS read must not be audited")
}

// TestConnectActionLogAuditsMutations proves the complement: a mutating RPC
// (Login carries no NO_SIDE_EFFECTS marker) is audited by default — the footgun
// the per-route REST LogRequest flag invites (M9) is gone. It is logged even
// though the handler is still unimplemented, and the row carries the procedure as
// its path with no body, preserving the metadata-only audit invariant.
func TestConnectActionLogAuditsMutations(t *testing.T) {
	t.Parallel()
	spy := &spyActionLogger{}
	client, _ := newTestConnectClientWithLogger(t, spy)

	_, _ = client.Login(context.Background(),
		connect.NewRequest(&servicerpcv1.LoginRequest{Email: "a@b.co", Password: "x"}))
	require.Equal(t, 1, spy.count(), "a mutation must be audited by default")

	row := spy.rows[0]
	require.Equal(t, servicev1connect.ImsServiceLoginProcedure, row.Path.String)
	require.Equal(t, http.MethodPost, row.Method.String)
	require.False(t, row.UserName.Valid, "anonymous caller: no user recorded")
}

// TestConnectListEventsUnauthenticated proves the first real domain RPC (1c) is
// wired and that its domain function (event.ListEvents) rejects an anonymous
// caller with CodeUnauthenticated — the check that fires before any DB access, so
// it needs no MariaDB. The authorized path is covered by the api/integration
// suite through the REST shim over the same function.
func TestConnectListEventsUnauthenticated(t *testing.T) {
	t.Parallel()
	client, _ := newTestConnectClient(t)

	_, err := client.ListEvents(context.Background(),
		connect.NewRequest(&servicerpcv1.ListEventsRequest{}))
	require.Error(t, err)
	require.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
}
