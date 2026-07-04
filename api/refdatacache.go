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
	"sync"
	"time"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/mikeki/ocf-ims/lib/cache"
)

// refDataCacheTTL bounds how long the incident-type taxonomy and an event's area
// list are reused before a fresh database read. Both are read on essentially
// every incident form load but change rarely, and every write path invalidates
// the relevant entry immediately (see EditIncidentTypes/ProposeIncidentType and
// EditAreas), so the TTL only caps staleness for out-of-band changes. A generous
// window keeps the whole-table reads off the hot path.
const refDataCacheTTL = 5 * time.Minute

// incidentTypesCache memoizes the fully built, sorted incident-type list. The
// taxonomy is global (not event-scoped) and identical for every caller with read
// access, so a single cache.InMemory serves them all. The entry is created lazily
// on the first read with that caller's refresh func; concurrent readers coalesce
// onto one database load (single-flight), so a burst of form loads can't stampede
// the table.
type incidentTypesCache struct {
	mu    sync.Mutex
	inner *cache.InMemory[imsjson.IncidentTypes]
}

func newIncidentTypesCache() *incidentTypesCache {
	return &incidentTypesCache{}
}

// Invalidate drops the cached list so the next read reloads from the database.
// Called after any create/approve/rename/hide so a taxonomy change shows up
// immediately rather than waiting out the TTL. A no-op before the first read.
func (c *incidentTypesCache) Invalidate() {
	c.mu.Lock()
	entry := c.inner
	c.mu.Unlock()
	if entry != nil {
		entry.Invalidate()
	}
}

// get returns the cached incident-type list, loading it via refresh on a miss or
// after the TTL. All callers pass an equivalent refresh; the first one wins and is
// reused for the life of the entry.
func (c *incidentTypesCache) get(
	ctx context.Context,
	refresh func(context.Context) (imsjson.IncidentTypes, error),
) (imsjson.IncidentTypes, error) {
	c.mu.Lock()
	if c.inner == nil {
		c.inner = cache.New(refDataCacheTTL, refresh)
	}
	entry := c.inner
	c.mu.Unlock()
	v, err := entry.Get(ctx)
	if err != nil {
		return nil, err
	}
	return *v, nil
}

// outcomesCache memoizes the fully built, sorted outcome list. Like the
// incident-type taxonomy it is global (not event-scoped) and identical for every
// caller with read access, so a single cache.InMemory serves them all with the same
// lazy-create + single-flight behavior.
type outcomesCache struct {
	mu    sync.Mutex
	inner *cache.InMemory[imsjson.Outcomes]
}

func newOutcomesCache() *outcomesCache {
	return &outcomesCache{}
}

// Invalidate drops the cached list so the next read reloads from the database.
// Called after any create/approve/rename/hide. A no-op before the first read.
func (c *outcomesCache) Invalidate() {
	c.mu.Lock()
	entry := c.inner
	c.mu.Unlock()
	if entry != nil {
		entry.Invalidate()
	}
}

// get returns the cached outcome list, loading it via refresh on a miss or after
// the TTL. All callers pass an equivalent refresh; the first one wins.
func (c *outcomesCache) get(
	ctx context.Context,
	refresh func(context.Context) (imsjson.Outcomes, error),
) (imsjson.Outcomes, error) {
	c.mu.Lock()
	if c.inner == nil {
		c.inner = cache.New(refDataCacheTTL, refresh)
	}
	entry := c.inner
	c.mu.Unlock()
	v, err := entry.Get(ctx)
	if err != nil {
		return nil, err
	}
	return *v, nil
}

// areasCache memoizes the built area list per event. Areas are per-event, so each
// event gets its own cache.InMemory (keyed by event name, the immutable event
// identifier used everywhere else), giving the same TTL + single-flight behavior
// as the metrics cache.
type areasCache struct {
	mu      sync.Mutex
	byEvent map[string]*cache.InMemory[imsjson.Areas]
}

func newAreasCache() *areasCache {
	return &areasCache{byEvent: map[string]*cache.InMemory[imsjson.Areas]{}}
}

// InvalidateEvent drops one event's cached area list after a create/approve/
// merge/rename so the change is visible on the next read. A no-op if the event
// was never cached.
func (c *areasCache) InvalidateEvent(eventName string) {
	c.mu.Lock()
	entry, ok := c.byEvent[eventName]
	c.mu.Unlock()
	if ok {
		entry.Invalidate()
	}
}

// get returns the cached area list for eventName, loading it via refresh on a miss
// or after the TTL. refresh captures the event id; a given event name always maps
// to the same id, so the first caller's refresh is safe to reuse.
func (c *areasCache) get(
	ctx context.Context,
	eventName string,
	refresh func(context.Context) (imsjson.Areas, error),
) (imsjson.Areas, error) {
	c.mu.Lock()
	entry, ok := c.byEvent[eventName]
	if !ok {
		entry = cache.New(refDataCacheTTL, refresh)
		c.byEvent[eventName] = entry
	}
	c.mu.Unlock()
	v, err := entry.Get(ctx)
	if err != nil {
		return nil, err
	}
	return *v, nil
}
