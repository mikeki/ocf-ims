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
	"sync"
	"time"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/cache"
)

// metricsCacheTTL is how long a computed per-event aggregate is reused. The
// dashboard auto-refreshes on roughly this cadence, so several admins watching
// the same event share one set of (heavy GROUP BY) queries per minute rather than
// each request hitting the database.
const metricsCacheTTL = time.Minute

// MetricsCache memoizes the dashboard aggregate per event with a short TTL. Each
// event gets its own cache.InMemory, which provides the TTL and single-flight
// (concurrent requests for the same event coalesce onto one refresh) — so a busy
// dashboard can't stampede the database.
type MetricsCache struct {
	mu      sync.Mutex
	byEvent map[string]*cache.InMemory[imsjson.Metrics]
}

func NewMetricsCache() *MetricsCache {
	return &MetricsCache{byEvent: map[string]*cache.InMemory[imsjson.Metrics]{}}
}

// InvalidateEvent drops the cached aggregate for one event so the next dashboard
// read recomputes from the database. Called after an event-scoped mutation
// (incident or area change) so the dashboard reflects the write immediately
// instead of waiting out the TTL. A no-op if the event was never cached.
func (c *MetricsCache) InvalidateEvent(eventName string) {
	c.mu.Lock()
	entry, ok := c.byEvent[eventName]
	c.mu.Unlock()
	if ok {
		entry.Invalidate()
	}
}

// InvalidateAll drops every event's cached aggregate. Used after a change to
// global reference data that the dashboard aggregates across events (the
// incident-type taxonomy), where a single event key can't target the effect.
func (c *MetricsCache) InvalidateAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, entry := range c.byEvent {
		entry.Invalidate()
	}
}

// Get returns the cached aggregate for eventName, computing it via refresh on a
// miss (or expiry). refresh is only consulted once per TTL per event even under
// concurrent load; errors are not cached.
func (c *MetricsCache) Get(
	ctx context.Context,
	eventName string,
	refresh func(context.Context) (imsjson.Metrics, error),
) (*imsjson.Metrics, error) {
	c.mu.Lock()
	entry, ok := c.byEvent[eventName]
	if !ok {
		entry = cache.New(metricsCacheTTL, refresh)
		c.byEvent[eventName] = entry
	}
	c.mu.Unlock()
	return entry.Get(ctx)
}
