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
	"context"
	"testing"

	"github.com/mikeki/ocf-ims/lib/push"
	"github.com/stretchr/testify/assert"
)

func TestDedupeRecipients(t *testing.T) {
	t.Parallel()

	const actor = int32(7)

	// Drops the actor, drops non-positive IDs, removes dupes, keeps first-seen order.
	got := dedupeRecipients([]int32{3, 7, 3, 0, -1, 5, 5, 3}, actor)
	assert.Equal(t, []int32{3, 5}, got)

	// A list that is only the actor / junk yields nothing, so fan-out short-circuits.
	assert.Empty(t, dedupeRecipients([]int32{7, 0, -2, 7}, actor))

	// Nil in, empty (non-nil) out.
	assert.Empty(t, dedupeRecipients(nil, actor))
}

// TestPushAppURLs pins the deep links to the same shape the in-app bell builds
// (ims.ts notificationHref), so a push click lands on the right page.
func TestPushAppURLs(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "/ims/app/events/2026/incidents/12", incidentAppURL("2026", 12))
	assert.Equal(t, "/ims/app/events/2026/reports/7", reportAppURL("2026", 7))

	// An event name with a space is percent-escaped as a single path segment.
	assert.Equal(t, "/ims/app/events/Test%20Event/incidents/3", incidentAppURL("Test Event", 3))
}

// TestFanOutDisabledIsNoOp verifies that with a disabled backend (the default
// NoopSender) the fan-out never reaches the send path, so unconfigured
// deployments do zero push work.
func TestFanOutDisabledIsNoOp(t *testing.T) {
	t.Parallel()

	spy := &spySender{enabled: false}
	p := NewPusher(nil, spy)
	// Would panic on a nil DBQ if it tried to deliver; the disabled gate stops it.
	p.notifyAddedToIncident(context.Background(), "2026", 12, 3, 7)
	p.notifyMentionedInIncident(context.Background(), "2026", 12, []int32{3, 4}, 7)
	p.notifyMentionedInReport(context.Background(), "2026", 9, []int32{3, 4}, 7)

	assert.Zero(t, spy.calls, "a disabled sender must never be invoked")
}

// spySender is a Sender that records whether it was asked to deliver.
type spySender struct {
	enabled bool
	calls   int
}

func (s *spySender) Enabled() bool { return s.enabled }

func (s *spySender) Send(context.Context, push.Subscription, push.Message) error {
	s.calls++
	return nil
}
