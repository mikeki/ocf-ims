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

package server

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/stretchr/testify/require"
)

// These exercise the interceptors that do not depend on the RPC's idempotency
// level (recovery, request id, auth). The action-log interceptor's read/write
// split needs a populated req.Spec(), which only the real Connect handler
// supplies, so it is proven end-to-end in api.TestConnectActionLog*.

// unaryReq builds a minimal connect.AnyRequest for driving an interceptor
// directly. The interceptors under test read only its headers, so the message
// type is irrelevant.
func unaryReq() connect.AnyRequest {
	return connect.NewRequest(&struct{}{})
}

// okUnary is a no-op handler that runs inspect against the context it was called
// with, so a test can pull out exactly what an interceptor placed there (a
// request id, claims) without capturing the context itself.
func okUnary(inspect func(ctx context.Context)) connect.UnaryFunc {
	return func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		if inspect != nil {
			inspect(ctx)
		}
		return connect.NewResponse(&struct{}{}), nil
	}
}

func TestRecoveryInterceptorTurnsPanicIntoInternal(t *testing.T) {
	t.Parallel()
	panicky := func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) {
		panic("boom")
	}
	wrapped := NewRecoveryInterceptor()(panicky)

	require.NotPanics(t, func() {
		_, err := wrapped(context.Background(), unaryReq())
		require.Equal(t, connect.CodeInternal, connect.CodeOf(err))
	})
}

func TestRequestIDInterceptorMintsAndEchoes(t *testing.T) {
	t.Parallel()
	var id string
	var ok bool
	req := unaryReq()
	resp, err := NewRequestIDInterceptor()(okUnary(func(ctx context.Context) {
		id, ok = RequestIDFromContext(ctx)
	}))(context.Background(), req)
	require.NoError(t, err)

	require.True(t, ok, "an id must be minted into the context")
	require.NotEmpty(t, id)
	require.Equal(t, id, resp.Header().Get(requestIDHeader), "the id must be echoed on the response")
}

func TestRequestIDInterceptorAdoptsInbound(t *testing.T) {
	t.Parallel()
	var id string
	req := unaryReq()
	req.Header().Set(requestIDHeader, "inbound-123")
	resp, err := NewRequestIDInterceptor()(okUnary(func(ctx context.Context) {
		id, _ = RequestIDFromContext(ctx)
	}))(context.Background(), req)
	require.NoError(t, err)

	require.Equal(t, "inbound-123", id, "an inbound id must be adopted, not replaced")
	require.Equal(t, "inbound-123", resp.Header().Get(requestIDHeader))
}

func TestAuthInterceptorPopulatesClaims(t *testing.T) {
	t.Parallel()
	jwter := authz.JWTer{SecretKey: "unit-test-secret"}
	token, err := jwter.CreateAccessToken("bob", 7, nil, false, nil, time.Now().Add(time.Hour))
	require.NoError(t, err)

	req := unaryReq()
	req.Header().Set("Authorization", "Bearer "+token)
	var handle string
	var id int32
	var ok bool
	_, err = NewAuthInterceptor(jwter)(okUnary(func(ctx context.Context) {
		if claims, present := ClaimsFromContext(ctx); present {
			ok, handle, id = true, claims.PersonHandle(), claims.PersonID()
		}
	}))(context.Background(), req)
	require.NoError(t, err)

	require.True(t, ok)
	require.Equal(t, "bob", handle)
	require.Equal(t, int32(7), id)
}

func TestAuthInterceptorAnonymousHasNoClaims(t *testing.T) {
	t.Parallel()
	jwter := authz.JWTer{SecretKey: "unit-test-secret"}
	var ok bool
	_, err := NewAuthInterceptor(jwter)(okUnary(func(ctx context.Context) {
		_, ok = ClaimsFromContext(ctx)
	}))(context.Background(), unaryReq())
	require.NoError(t, err)

	require.False(t, ok, "a request with no token must carry no claims")
}

func TestClaimsFromContextEmpty(t *testing.T) {
	t.Parallel()
	_, ok := ClaimsFromContext(context.Background())
	require.False(t, ok)
}
