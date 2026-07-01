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

// Package securityheaders adds a small set of hardening response headers to
// every IMS response (plan 90, finding L2). It's applied once, wrapping the
// combined API+web mux in cmd/serve.go, so both surfaces are covered.
//
// HSTS is intentionally NOT set here: it belongs at the TLS terminator (Caddy
// owns HTTPS in the reference deployment), and setting it on the app's plaintext
// hop is easy to get wrong. See deploy/Caddyfile.example for the Caddy side.
package securityheaders

import "net/http"

// ContentSecurityPolicy is shipped in REPORT-ONLY mode for now (see Handler).
// It is the policy we intend to eventually enforce: everything loads from our
// own origin, no framing, no plugins. The strict `script-src 'self'` (no
// 'unsafe-inline') is deliberately stricter than the app currently satisfies —
// the codebase still uses inline on*= event handlers and an inline importmap, so
// enforcing it today would break the UI. Report-only lets the browser log those
// violations (visible in devtools) without breaking anything, giving us the
// inventory to migrate handlers to addEventListener; once the console is clean,
// flip the header name in Handler to the enforcing "Content-Security-Policy".
//
// style-src keeps 'unsafe-inline' (Bootstrap + inline style attributes; style
// injection is far lower risk than script injection). img-src allows data: URIs,
// which Bootstrap uses for inline SVG icons in CSS.
const ContentSecurityPolicy = "default-src 'self'; " +
	"base-uri 'self'; " +
	"object-src 'none'; " +
	"frame-ancestors 'none'; " +
	"form-action 'self'; " +
	"img-src 'self' data:; " +
	"style-src 'self' 'unsafe-inline'; " +
	"script-src 'self'"

// Handler wraps next so every response carries the hardening headers:
//
//   - X-Content-Type-Options: nosniff — browsers must honor the declared
//     Content-Type instead of sniffing (defense-in-depth for attachment serving,
//     which already downgrades unsafe types to octet-stream).
//   - X-Frame-Options: DENY — IMS is never legitimately framed; this is the
//     enforcing anti-clickjacking control (CSP frame-ancestors is report-only).
//   - Referrer-Policy: strict-origin-when-cross-origin — don't leak incident URLs
//     in the Referer header on outbound navigation.
//   - Content-Security-Policy-Report-Only — observe violations without enforcing;
//     see ContentSecurityPolicy.
func Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Content-Security-Policy-Report-Only", ContentSecurityPolicy)
		next.ServeHTTP(w, r)
	})
}
