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
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeClock is a manually-advanced clock for deterministic limiter tests.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func testLimiter(clk *fakeClock) *loginRateLimiter {
	return newLoginRateLimiter(loginRateLimiterConfig{
		enabled:       true,
		maxFailures:   5,
		lockout:       15 * time.Minute,
		backoffThresh: 3,
		backoffBase:   1 * time.Second,
		backoffMax:    30 * time.Second,
		resetWindow:   15 * time.Minute,
		now:           clk.now,
	})
}

func TestLimiter_AllowsUntilBackoffThreshold(t *testing.T) {
	t.Parallel()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	l := testLimiter(clk)

	// First (backoffThresh) failures carry no delay.
	for i := range 3 {
		ok, _ := l.allow("id:alice")
		require.True(t, ok, "attempt %d should be allowed", i)
		l.recordFailure("id:alice")
	}
	// The 4th attempt is now delayed by the backoff (base = 1s).
	ok, wait := l.allow("id:alice")
	assert.False(t, ok)
	assert.Equal(t, 1*time.Second, wait)

	// Waiting out the backoff lets it through again.
	clk.advance(1 * time.Second)
	ok, _ = l.allow("id:alice")
	assert.True(t, ok)
}

func TestLimiter_BackoffIsExponentialAndCapped(t *testing.T) {
	t.Parallel()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	l := newLoginRateLimiter(loginRateLimiterConfig{
		enabled: true, maxFailures: 100, lockout: time.Hour,
		backoffThresh: 3, backoffBase: time.Second, backoffMax: 30 * time.Second,
		resetWindow: time.Hour, now: clk.now,
	})
	// failures: 3→1s, 4→2s, 5→4s, 6→8s, 7→16s, 8→30s(capped from 32s)
	wantSecs := []int{1, 2, 4, 8, 16, 30}
	for i, w := range wantSecs {
		// drive the failure count up to (3 + i)
		for l.attempts["id:x"] == nil || l.attempts["id:x"].failures < 3+i {
			l.recordFailure("id:x")
		}
		_, wait := l.allow("id:x")
		assert.Equalf(t, time.Duration(w)*time.Second, wait, "failure count %d", 3+i)
	}
}

func TestLimiter_LocksOutAtCeiling(t *testing.T) {
	t.Parallel()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	l := testLimiter(clk)

	for range 5 {
		l.recordFailure("ip:1.2.3.4")
		clk.advance(1 * time.Second) // step past each backoff so we reach the ceiling
	}
	ok, wait := l.allow("ip:1.2.3.4")
	assert.False(t, ok)
	assert.InDelta(t, (15 * time.Minute).Seconds(), wait.Seconds(), 5)

	// Still locked just before expiry.
	clk.advance(14 * time.Minute)
	ok, _ = l.allow("ip:1.2.3.4")
	assert.False(t, ok)

	// After the lockout elapses, the key is fresh again.
	clk.advance(2 * time.Minute)
	ok, _ = l.allow("ip:1.2.3.4")
	assert.True(t, ok)
}

func TestLimiter_SuccessResets(t *testing.T) {
	t.Parallel()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	l := testLimiter(clk)

	for range 3 {
		l.recordFailure("id:bob")
	}
	// backoff now in effect
	ok, _ := l.allow("id:bob")
	require.False(t, ok)

	l.recordSuccess("id:bob")
	ok, _ = l.allow("id:bob")
	assert.True(t, ok, "a successful login clears the failure history")
}

func TestLimiter_PerKeyIsolation(t *testing.T) {
	t.Parallel()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	l := testLimiter(clk)

	// Lock out alice entirely.
	for range 5 {
		l.recordFailure("id:alice")
		clk.advance(time.Second)
	}
	ok, _ := l.allow("id:alice")
	require.False(t, ok)

	// A different account is unaffected.
	ok, _ = l.allow("id:carol")
	assert.True(t, ok)
	// As is a different IP.
	ok, _ = l.allow("ip:9.9.9.9")
	assert.True(t, ok)
}

func TestLimiter_IdleResetForgetsHistory(t *testing.T) {
	t.Parallel()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	l := testLimiter(clk)

	for range 3 {
		l.recordFailure("id:dave")
	}
	ok, _ := l.allow("id:dave")
	require.False(t, ok) // in backoff

	// Long idle gap past the reset window wipes the history.
	clk.advance(16 * time.Minute)
	ok, _ = l.allow("id:dave")
	assert.True(t, ok)
}

func TestLimiter_DisabledIsNoop(t *testing.T) {
	t.Parallel()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	l := newLoginRateLimiter(loginRateLimiterConfig{enabled: false, now: clk.now})
	for range 100 {
		l.recordFailure("id:x")
	}
	ok, wait := l.allow("id:x")
	assert.True(t, ok)
	assert.Zero(t, wait)
}

func TestClientIPForRateLimit(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		remoteAddr string
		cfIP       string
		xff        string
		want       string
	}{
		{"remoteaddr only", "203.0.113.7:5555", "", "", "203.0.113.7"},
		{"cf header wins", "10.0.0.1:80", "198.51.100.9", "1.1.1.1", "198.51.100.9"},
		{"xff rightmost is the trusted hop", "10.0.0.1:80", "", "1.2.3.4, 203.0.113.9", "203.0.113.9"},
		{"single xff", "10.0.0.1:80", "", "203.0.113.5", "203.0.113.5"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequest(http.MethodPost, "/ims/api/auth", nil)
			r.RemoteAddr = tc.remoteAddr
			if tc.cfIP != "" {
				r.Header.Set("CF-Connecting-IP", tc.cfIP)
			}
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			assert.Equal(t, tc.want, clientIPForRateLimit(r))
		})
	}
}

func TestPeekIdentificationRestoresBody(t *testing.T) {
	t.Parallel()
	body := `{"identification":"Alice","password":"hunter2"}`
	r := httptest.NewRequest(http.MethodPost, "/ims/api/auth", strings.NewReader(body))
	id := peekIdentification(r)
	assert.Equal(t, "Alice", id)

	// The downstream handler must still see the full, untouched body.
	got, err := io.ReadAll(r.Body)
	require.NoError(t, err)
	assert.Equal(t, body, string(got))
}
