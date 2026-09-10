// SPDX-License-Identifier: Apache-2.0

package api_test

import (
	"context"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	servicerpcv1 "github.com/mikeki/ocf-ims/gen/ocf/ims/service/rpc/v1"
	"github.com/mikeki/ocf-ims/gen/ocf/ims/service/v1/servicev1connect"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/stretchr/testify/require"
)

// The session-contract tests for slice 3a.0 (plan 09j) that need no database: Logout touches
// no state, and the report reads reject an anonymous caller before any DB access. The
// Login/RefreshToken body-vs-cookie round trip needs real users and lives in api/integration.

// TestConnectLogoutClearsCookieAndIsAudited proves the Logout RPC end to end through the real
// handler: an ANONYMOUS call (the access token may already have expired — a logout must never
// fail) succeeds, the response carries the clearing refresh cookie — same name, path and
// attributes as the one Login sets, empty value, Max-Age=0 — and, Logout being un-annotated in
// the contract, the action-log interceptor records it (procedure only, no body, no user).
func TestConnectLogoutClearsCookieAndIsAudited(t *testing.T) {
	t.Parallel()
	spy := &spyActionLogger{}
	client, _ := newTestConnectClientWithLogger(t, spy)

	resp, err := client.Logout(context.Background(), connect.NewRequest(&servicerpcv1.LogoutRequest{}))
	require.NoError(t, err)

	cookie, err := http.ParseSetCookie(resp.Header().Get("Set-Cookie"))
	require.NoError(t, err)
	require.Equal(t, authz.RefreshTokenCookieName, cookie.Name)
	require.Empty(t, cookie.Value)
	require.Negative(t, cookie.MaxAge, "Max-Age=0 on the wire parses as MaxAge<0: expire now")
	require.Equal(t, "/", cookie.Path)
	require.True(t, cookie.HttpOnly)
	require.True(t, cookie.Secure)
	require.Equal(t, http.SameSiteStrictMode, cookie.SameSite)
	require.Equal(t, "no-store", resp.Header().Get("Cache-Control"))

	require.Equal(t, 1, spy.count(), "Logout must be audited like Login")
	row := spy.rows[0]
	require.Equal(t, servicev1connect.ImsServiceLogoutProcedure, row.Path.String)
	require.False(t, row.UserName.Valid, "anonymous caller: no user recorded")
}

// TestConnectReportReadsNotAudited proves the 3a.0 contract fix: ListReports and GetReport now
// carry NO_SIDE_EFFECTS, so the action-log interceptor skips them like every other read. Both
// are called anonymously and reject with Unauthenticated before touching the DB; the audit
// decision is made on the method's idempotency level regardless of the outcome, so a
// still-unmarked read would have produced a row here.
func TestConnectReportReadsNotAudited(t *testing.T) {
	t.Parallel()
	spy := &spyActionLogger{}
	client, _ := newTestConnectClientWithLogger(t, spy)

	_, err := client.ListReports(context.Background(),
		connect.NewRequest(&servicerpcv1.ListReportsRequest{EventId: 1}))
	require.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))
	_, err = client.GetReport(context.Background(),
		connect.NewRequest(&servicerpcv1.GetReportRequest{EventId: 1, ReportNumber: 1}))
	require.Equal(t, connect.CodeUnauthenticated, connect.CodeOf(err))

	require.Zero(t, spy.count(), "NO_SIDE_EFFECTS reads must not be audited")
}
