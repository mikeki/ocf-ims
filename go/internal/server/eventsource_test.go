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
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

// oracle builds an EventSourcerer whose privacy lookup returns the given result, so
// the redaction branch can be exercised without a database or a real SSE server.
func esWithOracle(private bool, err error) *EventSourcerer {
	return NewEventSourcerer(func(context.Context, int32, int32) (bool, error) {
		return private, err
	})
}

// TestNewEventSourcerer_NilOraclePanics proves the constructor refuses a nil privacy
// oracle: a miswired server must fail loudly rather than silently broadcast private
// incident numbers.
func TestNewEventSourcerer_NilOraclePanics(t *testing.T) {
	t.Parallel()
	require.Panics(t, func() { NewEventSourcerer(nil) })
}

// TestIncidentEventData_KeepsNumberForNonPrivate proves a non-private incident poke
// carries its number, so clients can refetch that one incident surgically.
func TestIncidentEventData_KeepsNumberForNonPrivate(t *testing.T) {
	t.Parallel()
	data := esWithOracle(false, nil).incidentEventData(context.Background(), 7, 42)
	require.Equal(t, int32(7), data.EventID)
	require.Equal(t, int32(42), data.IncidentNumber)
	require.False(t, data.UpdateAllIncidents)
}

// TestIncidentEventData_RedactsPrivate proves a private incident poke omits the number
// and instead asks clients to reload the gated list (UpdateAllIncidents), so the
// number never crosses the wire.
func TestIncidentEventData_RedactsPrivate(t *testing.T) {
	t.Parallel()
	data := esWithOracle(true, nil).incidentEventData(context.Background(), 7, 42)
	require.Equal(t, int32(7), data.EventID)
	require.Zero(t, data.IncidentNumber, "a private incident's number must not be broadcast")
	require.True(t, data.UpdateAllIncidents)
}

// TestIncidentEventData_FailsSafeOnError proves an oracle error redacts (fails safe):
// if we can't tell whether an incident is private, we must not leak its number.
func TestIncidentEventData_FailsSafeOnError(t *testing.T) {
	t.Parallel()
	data := esWithOracle(false, errors.New("db down")).incidentEventData(context.Background(), 7, 42)
	require.Zero(t, data.IncidentNumber, "a lookup failure must not leak the number")
	require.True(t, data.UpdateAllIncidents)
}

// TestIMSEvent_RedactedRoutesAsIncident proves a redacted poke still routes to the
// client's "Incident" listener and marshals as `update_all` (which the web client
// already treats as a full gated reload), carrying no incident_number.
func TestIMSEvent_RedactedRoutesAsIncident(t *testing.T) {
	t.Parallel()
	e := IMSEvent{EventData: IMSEventData{EventID: 7, UpdateAllIncidents: true}}
	require.Equal(t, "Incident", e.Event())

	data := e.Data()
	require.Contains(t, data, "\"update_all\":true")
	require.NotContains(t, data, "incident_number", "redacted poke must omit the number")
}
