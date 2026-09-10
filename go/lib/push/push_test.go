// SPDX-License-Identifier: Apache-2.0

package push_test

import (
	"testing"

	"github.com/mikeki/ocf-ims/lib/push"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNoopSender(t *testing.T) {
	t.Parallel()
	var s push.Sender = push.NoopSender{}

	// The no-op backend reports itself disabled so callers skip fan-out...
	assert.False(t, s.Enabled())
	// ...but a Send is still a no-op success (never errors).
	require.NoError(t, s.Send(
		t.Context(),
		push.Subscription{Endpoint: "https://example.test/p/abc", P256dh: "key", Auth: "secret"},
		push.Message{Title: "t", Body: "b", URL: "/ims/app"},
	))
}
