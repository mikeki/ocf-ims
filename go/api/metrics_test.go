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
	"sync/atomic"
	"testing"
	"time"

	"github.com/mikeki/ocf-ims/internal/server"
	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMetricsCacheMemoizes verifies the per-event metrics cache only consults its
// refresher once per event within the TTL, keeps events independent, and
// coalesces concurrent requests for the same event onto a single refresh
// (single-flight) — the property that protects the database from a dashboard
// stampede.
func TestMetricsCacheMemoizes(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	c := server.NewMetricsCache()

	var calls atomic.Int64
	refresh := func(event string) func(context.Context) (imsjson.Metrics, error) {
		return func(context.Context) (imsjson.Metrics, error) {
			calls.Add(1)
			// Hold briefly so concurrent callers for the same event overlap and
			// exercise the single-flight path.
			time.Sleep(10 * time.Millisecond)
			return imsjson.Metrics{Event: event}, nil
		}
	}

	// Repeated sequential gets for one event hit the refresher once.
	for range 5 {
		m, err := c.Get(ctx, "EventA", refresh("EventA"))
		require.NoError(t, err)
		assert.Equal(t, "EventA", m.Event)
	}
	assert.Equal(t, int64(1), calls.Load())

	// A different event computes independently (one more call).
	m, err := c.Get(ctx, "EventB", refresh("EventB"))
	require.NoError(t, err)
	assert.Equal(t, "EventB", m.Event)
	assert.Equal(t, int64(2), calls.Load())

	// A concurrent burst for a fresh event coalesces onto one refresh.
	calls.Store(0)
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			_, err := c.Get(ctx, "EventC", refresh("EventC"))
			assert.NoError(t, err)
		})
	}
	wg.Wait()
	assert.Equal(t, int64(1), calls.Load())
}

// TestMetricsCacheDoesNotCacheErrors verifies a failed refresh isn't stored, so a
// transient error (e.g. a momentary DB blip) doesn't get pinned for the whole TTL.
func TestMetricsCacheDoesNotCacheErrors(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	c := server.NewMetricsCache()

	var calls atomic.Int64
	boom := func(context.Context) (imsjson.Metrics, error) {
		calls.Add(1)
		return imsjson.Metrics{}, assert.AnError
	}

	_, err := c.Get(ctx, "EventA", boom)
	require.Error(t, err)
	_, err = c.Get(ctx, "EventA", boom)
	require.Error(t, err)
	// Both calls re-ran the refresher because the error wasn't cached.
	assert.Equal(t, int64(2), calls.Load())
}
