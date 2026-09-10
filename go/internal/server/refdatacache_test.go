// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"sync/atomic"
	"testing"

	imsjson "github.com/mikeki/ocf-ims/json"
	"github.com/stretchr/testify/require"
)

func TestIncidentTypesCache_CachesUntilInvalidated(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	var loads atomic.Int32
	refresh := func(_ context.Context) (imsjson.IncidentTypes, error) {
		loads.Add(1)
		return imsjson.IncidentTypes{}, nil
	}

	c := NewIncidentTypesCache()

	// First read loads; a second read within the TTL is served from cache.
	_, err := c.Get(ctx, refresh)
	require.NoError(t, err)
	_, err = c.Get(ctx, refresh)
	require.NoError(t, err)
	require.Equal(t, int32(1), loads.Load(), "second read should hit the cache")

	// Invalidate forces the next read to reload.
	c.Invalidate()
	_, err = c.Get(ctx, refresh)
	require.NoError(t, err)
	require.Equal(t, int32(2), loads.Load(), "read after invalidate should reload")
}

func TestAreasCache_IsPerEvent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	var loads atomic.Int32
	refresh := func(_ context.Context) (imsjson.Areas, error) {
		loads.Add(1)
		return imsjson.Areas{}, nil
	}

	c := NewAreasCache()

	// Each event caches independently, so two distinct events load once each.
	_, err := c.Get(ctx, "2026", refresh)
	require.NoError(t, err)
	_, err = c.Get(ctx, "2027", refresh)
	require.NoError(t, err)
	require.Equal(t, int32(2), loads.Load())

	// A repeat read for a cached event does not reload.
	_, err = c.Get(ctx, "2026", refresh)
	require.NoError(t, err)
	require.Equal(t, int32(2), loads.Load())

	// Invalidating one event does not disturb the other.
	c.InvalidateEvent("2026")
	_, err = c.Get(ctx, "2026", refresh)
	require.NoError(t, err)
	_, err = c.Get(ctx, "2027", refresh)
	require.NoError(t, err)
	require.Equal(t, int32(3), loads.Load(), "only the invalidated event should reload")
}
