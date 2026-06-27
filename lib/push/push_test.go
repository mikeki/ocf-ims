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
