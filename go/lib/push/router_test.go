// SPDX-License-Identifier: Apache-2.0

package push

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// The Router (plan 09p slice 3b.0c) is what kept the fan-out from learning that
// there is more than one push service.

type recordingSender struct {
	enabled bool
	sent    []Subscription
}

func (r *recordingSender) Send(_ context.Context, sub Subscription, _ Message) error {
	r.sent = append(r.sent, sub)
	return nil
}
func (r *recordingSender) Enabled() bool { return r.enabled }

func TestRouterSendsToTheBackendOwningTheKind(t *testing.T) {
	t.Parallel()
	web := &recordingSender{enabled: true}
	expo := &recordingSender{enabled: true}
	router := NewRouter(map[Kind]Sender{KindWeb: web, KindExpo: expo})

	require.NoError(t, router.Send(t.Context(), Subscription{Kind: KindWeb, Endpoint: "https://push/1"}, Message{}))
	require.NoError(t, router.Send(t.Context(), Subscription{Kind: KindExpo, Endpoint: "ExponentPushToken[a]"}, Message{}))

	require.Len(t, web.sent, 1)
	require.Equal(t, "https://push/1", web.sent[0].Endpoint)
	require.Len(t, expo.sent, 1)
	require.Equal(t, "ExponentPushToken[a]", expo.sent[0].Endpoint)
}

// An unconfigured backend is not a delivery failure. If it returned one, the
// fan-out's prune path would treat it as such and could delete a good device.
func TestRouterSkipsAnUnconfiguredKindWithoutError(t *testing.T) {
	t.Parallel()
	web := &recordingSender{enabled: true}
	router := NewRouter(map[Kind]Sender{KindWeb: web, KindExpo: NoopSender{}})

	require.NoError(t, router.Send(t.Context(), Subscription{Kind: KindExpo, Endpoint: "tok"}, Message{}))
	require.NoError(t, router.Send(t.Context(), Subscription{Kind: "unknown", Endpoint: "tok"}, Message{}))
	require.Empty(t, web.sent)
}

func TestRouterEnabledWhenAnyBackendIs(t *testing.T) {
	t.Parallel()
	require.False(t, NewRouter(map[Kind]Sender{KindWeb: NoopSender{}, KindExpo: NoopSender{}}).Enabled(),
		"neither push service configured means skip the fan-out entirely")
	require.True(t, NewRouter(map[Kind]Sender{
		KindWeb: NoopSender{}, KindExpo: &recordingSender{enabled: true},
	}).Enabled())
}
