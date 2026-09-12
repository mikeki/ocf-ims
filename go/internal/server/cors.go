// SPDX-License-Identifier: Apache-2.0

package server

import (
	"net/http"
	"slices"
	"time"

	connectcors "connectrpc.com/cors"
	"github.com/rs/cors"
)

// corsPreflightMaxAge is how long a browser may cache a preflight answer. Ten minutes
// keeps the dev loop from paying an OPTIONS round-trip per call without hiding a
// config change for long.
const corsPreflightMaxAge = 10 * time.Minute

// CORS builds the cross-origin adapter for the development allow-list
// (conf.ConfigCore.CORSAllowedOrigins / IMS_CORS_ALLOWED_ORIGINS — plan 09i E9, slice
// 3a.0). The Expo dev server (:8081) calls the docker stack (:8090) from another
// origin, WITH credentials (the web refresh cookie), so the policy is: exact origin
// allow-list echoed back (never "*", which browsers refuse alongside credentials),
// Access-Control-Allow-Credentials, the two methods Connect and the blob routes use,
// the request headers Connect needs plus Authorization and X-Request-Id, and the
// response headers a client must be able to read — Connect's own, the request id,
// Retry-After (the login throttle), Content-Disposition (attachment downloads) and
// IMS-Journal-Entry-Number (the entry an upload made).
//
// An EMPTY allow-list returns the identity adapter: no Access-Control-* header is
// ever emitted and no preflight is answered, so a production server — same-origin by
// construction, no CORS wanted — behaves exactly as before this adapter existed.
// Callers apply it OUTERMOST (before RequireAuthN) so the headers land on a 401 too,
// and the browser can read that error instead of reporting an opaque CORS failure.
//
// It composes with server.Adapt for the REST blob routes and wraps the Connect
// handler directly (both are plain http.Handlers). Note the method-specific REST
// patterns ("POST /path") never receive an OPTIONS preflight — the mux answers 405
// first — so a caller registering CORS on such routes also registers a preflight
// route (see api.AddToMux).
//
// rs/cors (≥ 1.11) validates a preflight's Access-Control-Request-Headers in the
// exact form the Fetch spec has browsers send — names byte-lowercased, sorted and
// unique — and refuses anything else. Browsers always comply; a hand-rolled
// preflight (curl, a test) must too, or the whole preflight is denied.
func CORS(allowedOrigins []string) Adapter {
	if len(allowedOrigins) == 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	c := cors.New(cors.Options{
		AllowedOrigins:   slices.Clone(allowedOrigins),
		AllowCredentials: true,
		AllowedMethods:   connectcors.AllowedMethods(), // GET + POST: Connect, and what the blob routes use
		AllowedHeaders:   append(connectcors.AllowedHeaders(), "Authorization", requestIDHeader),
		ExposedHeaders:   append(connectcors.ExposedHeaders(), requestIDHeader, "Retry-After", "Content-Disposition", "IMS-Journal-Entry-Number"),
		MaxAge:           int(corsPreflightMaxAge.Seconds()),
	})
	return c.Handler
}

// CORSEnabled reports whether the allow-list turns CORS on — the condition under which
// a caller registers the preflight route the method-specific REST patterns need.
func CORSEnabled(allowedOrigins []string) bool {
	return len(allowedOrigins) > 0
}
