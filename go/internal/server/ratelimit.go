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
	"math"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

// Login rate-limiting (plan 90, finding H1 + M4).
//
// The login RPC (ImsService.Login) is unauthenticated and takes an email + password,
// so without throttling it is an open door to online credential stuffing; a cracked
// admin password is full access. Separately, every password verify serialises on
// a process-wide argon2 mutex (lib/authn.argonLocker, bounding memory), so a login
// flood starves legitimate logins. Both are mitigated by shedding failed and excess
// attempts *before* the verify runs, rather than queueing them.
//
// This file holds the limiter itself; enforcement lives in the Login domain method
// (internal/auth), which calls Allow before the verify and RecordFailure /
// RecordSuccess after, keying on ClientIP and the lowercased email. (Before slice 1c
// the same limiter drove a REST ThrottleLogin middleware over POST /ims/api/auth; that
// route and its adapter were retired when Login moved onto Connect.)
//
// The limiter tracks failures per client IP AND per identification (the email), so a
// single host hammering many accounts trips the IP key while a distributed guess
// against one account trips the identification key. Counters live in memory: this is a
// single-instance deployment, and a process restart clearing the counters is an
// acceptable trade for zero extra infrastructure. See docs/plans/90.
const (
	// defaultLoginMaxFailures is the number of consecutive failures (per key) that
	// triggers a temporary lockout.
	defaultLoginMaxFailures = 8
	// defaultLoginLockout is how long a key stays locked once it hits the failure
	// ceiling.
	defaultLoginLockout = 15 * time.Minute
	// loginBackoffThreshold is the failure count past which we start inserting an
	// exponential delay between attempts (before the hard lockout kicks in). The
	// first few fat-finger retries are free; sustained guessing slows down fast.
	loginBackoffThreshold = 3
	// loginBackoffBase is the initial backoff, doubled per failure past the
	// threshold, capped at loginBackoffMax.
	loginBackoffBase = 1 * time.Second
	loginBackoffMax  = 30 * time.Second
	// loginResetWindow is how long a key can sit idle before its failure history is
	// forgotten, so an occasional mistype days apart never accumulates to a lockout.
	loginResetWindow = 15 * time.Minute
	// loginPruneThreshold bounds map growth: once the map exceeds this many keys we
	// opportunistically drop stale entries on the next failure.
	loginPruneThreshold = 4096
)

// loginRateLimiterConfig is the tunable policy for a LoginRateLimiter. Production
// uses the default* constants; tests inject small values and a fake clock.
type loginRateLimiterConfig struct {
	enabled       bool
	maxFailures   int
	lockout       time.Duration
	backoffThresh int
	backoffBase   time.Duration
	backoffMax    time.Duration
	resetWindow   time.Duration
	now           func() time.Time
}

func DefaultLoginRateLimiterConfig(enabled bool) loginRateLimiterConfig {
	return loginRateLimiterConfig{
		enabled:       enabled,
		maxFailures:   defaultLoginMaxFailures,
		lockout:       defaultLoginLockout,
		backoffThresh: loginBackoffThreshold,
		backoffBase:   loginBackoffBase,
		backoffMax:    loginBackoffMax,
		resetWindow:   loginResetWindow,
		now:           time.Now,
	}
}

type attemptState struct {
	failures    int
	lastFailure time.Time
	lockedUntil time.Time
}

// LoginRateLimiter is a small in-memory failed-attempt tracker keyed by an opaque
// string. It is safe for concurrent use.
type LoginRateLimiter struct {
	cfg loginRateLimiterConfig
	mu  sync.Mutex
	// attempts maps a namespaced key ("ip:1.2.3.4" / "id:handle") to its state.
	attempts map[string]*attemptState
}

func NewLoginRateLimiter(cfg loginRateLimiterConfig) *LoginRateLimiter {
	if cfg.now == nil {
		cfg.now = time.Now
	}
	return &LoginRateLimiter{cfg: cfg, attempts: make(map[string]*attemptState)}
}

// Allow reports whether an attempt for key may proceed right now. When it may not,
// it returns the suggested wait until the next attempt (for a Retry-After header).
// Allow is read-mostly: it only removes fully-expired state, it never records a
// failure — recording happens in RecordFailure once the outcome is known.
func (l *LoginRateLimiter) Allow(key string) (bool, time.Duration) {
	if !l.cfg.enabled {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	st := l.attempts[key]
	if st == nil {
		return true, 0
	}
	now := l.cfg.now()
	if now.Before(st.lockedUntil) {
		return false, st.lockedUntil.Sub(now)
	}
	// A previously-locked key whose lockout has elapsed, or any key idle past the
	// reset window, starts fresh.
	if !st.lockedUntil.IsZero() || now.Sub(st.lastFailure) > l.cfg.resetWindow {
		delete(l.attempts, key)
		return true, 0
	}
	if st.failures >= l.cfg.backoffThresh {
		if wait := st.lastFailure.Add(l.backoffFor(st.failures)).Sub(now); wait > 0 {
			return false, wait
		}
	}
	return true, 0
}

// RecordFailure registers one failed attempt for key, applying the lockout once the
// ceiling is reached.
func (l *LoginRateLimiter) RecordFailure(key string) {
	if !l.cfg.enabled {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.cfg.now()
	if len(l.attempts) > loginPruneThreshold {
		l.pruneLocked(now)
	}
	st := l.attempts[key]
	if st == nil {
		st = &attemptState{}
		l.attempts[key] = st
	}
	// Forget stale history: a lapsed lockout or a long idle gap resets the count so
	// the current failure is treated as the first of a new run.
	if (!st.lockedUntil.IsZero() && now.After(st.lockedUntil)) || now.Sub(st.lastFailure) > l.cfg.resetWindow {
		st.failures = 0
		st.lockedUntil = time.Time{}
	}
	st.failures++
	st.lastFailure = now
	if st.failures >= l.cfg.maxFailures {
		st.lockedUntil = now.Add(l.cfg.lockout)
	}
}

// RecordSuccess clears any failure history for key, so a successful login resets the
// counter immediately.
func (l *LoginRateLimiter) RecordSuccess(key string) {
	if !l.cfg.enabled {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, key)
}

func (l *LoginRateLimiter) backoffFor(failures int) time.Duration {
	// failures == backoffThresh → backoffBase, doubling each additional failure.
	exp := failures - l.cfg.backoffThresh
	if exp < 0 {
		return 0
	}
	// Guard against overflow on the shift for absurd exponents.
	if exp > 32 {
		return l.cfg.backoffMax
	}
	d := time.Duration(float64(l.cfg.backoffBase) * math.Pow(2, float64(exp)))
	if d > l.cfg.backoffMax {
		return l.cfg.backoffMax
	}
	return d
}

// pruneLocked drops entries whose state is fully expired (unlocked and idle past the
// reset window). Caller holds l.mu.
func (l *LoginRateLimiter) pruneLocked(now time.Time) {
	for k, st := range l.attempts {
		if now.Before(st.lockedUntil) {
			continue
		}
		if now.Sub(st.lastFailure) > l.cfg.resetWindow {
			delete(l.attempts, k)
		}
	}
}

// ClientIP derives the throttling IP from a request's forwarded headers and transport
// remote address, and must resist spoofing — a forgeable key would let one host
// masquerade as many and slip the per-IP limit. It takes the header map and remote
// address rather than an *http.Request so it serves both transports: the REST caller
// passes r.Header / r.RemoteAddr, the Connect Login delegate passes req.Header() /
// req.Peer().Addr.
//
// The app is not reachable directly (no published port — see
// deploy/Caddyfile.example); the sole ingress is our own reverse proxy (Caddy),
// which appends the real connecting peer to the RIGHT of any client-supplied
// X-Forwarded-For. So the RIGHTMOST XFF entry is Caddy's own trustworthy view and
// can't be spoofed (a forged XFF is pushed left of it); we key on that, else the
// transport remote address.
//
// We deliberately do NOT trust CF-Connecting-IP (or a left/whole XFF): Caddy does
// not manage those, so a client could vary them per request to mint a fresh key
// each time and defeat the per-IP throttle entirely. This assumes exactly one
// trusted proxy hop (the Caddy-only topology we ship); a future Cloudflare→Caddy
// deployment would need the trusted-hop count made configurable here.
func ClientIP(header http.Header, remoteAddr string) string {
	if xff := header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		last := strings.TrimSpace(parts[len(parts)-1])
		if last != "" {
			return last
		}
	}
	addrPort, err := netip.ParseAddrPort(remoteAddr)
	if err == nil {
		return addrPort.Addr().String()
	}
	return remoteAddr
}
