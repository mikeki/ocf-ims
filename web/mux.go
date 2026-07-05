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

package web

import (
	"fmt"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"path"
	"runtime/debug"
	"strings"
	"time"

	"github.com/a-h/templ"
	"github.com/mikeki/ocf-ims/conf"
	"github.com/mikeki/ocf-ims/lib/authz"
	"github.com/mikeki/ocf-ims/lib/herr"
	"github.com/mikeki/ocf-ims/web/template"
)

// Go's default MIME table has no entry for .webmanifest, so http.FileServerFS
// would serve the PWA manifest as text/plain (content sniffing). Register the
// spec media type so it's served as application/manifest+json — browsers want
// that for install, and iOS Add-to-Home-Screen (the web-push prerequisite on
// iPhone) is pickier about it.
func init() {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func AddToMux(mux *http.ServeMux, cfg *conf.IMSConfig) *http.ServeMux {
	if mux == nil {
		mux = http.NewServeMux()
	}

	// Supply a default versionName and fake ref, in case BuildInfo is unavailable.
	// This version name is just the current UTC time, all smushed together.
	versionName := time.Now().UTC().Format("20060102150405")
	versionRef := "deadbeef"
	bi, _ := debug.ReadBuildInfo()
	if bi != nil {
		// e.g. "20250629122355-7254ff315bc4"
		_, versionName, _ = strings.Cut(bi.Main.Version, "-")
		for _, v := range bi.Settings {
			if v.Key == "vcs.revision" {
				versionRef = v.Value
			}
		}
	}

	deployment := string(cfg.Core.Deployment)
	mux.Handle("GET /ims/static/ext/",
		Adapt(
			http.StripPrefix("/ims/", http.FileServerFS(StaticFS)).ServeHTTP,
			CacheControl(cfg.Core.CacheControlLong),
		),
	)
	mux.Handle("GET /ims/static/logos/",
		Adapt(
			http.StripPrefix("/ims/", http.FileServerFS(StaticFS)).ServeHTTP,
			CacheControl(cfg.Core.CacheControlLong),
		),
	)
	mux.Handle("GET /ims/static/",
		Adapt(
			http.StripPrefix("/ims/", http.FileServerFS(StaticFS)).ServeHTTP,
			CacheControl(cfg.Core.CacheControlLong),
		),
	)
	// The push service worker (plan 84) is served from /ims/sw.js rather than under
	// /ims/static/ so its default scope is the whole /ims/ tree — that lets a
	// notification click focus any open IMS tab. Service-Worker-Allowed is set
	// belt-and-suspenders; the script's own path already grants the /ims/ scope.
	// Short cache so an updated worker rolls out promptly.
	mux.Handle("GET /ims/sw.js",
		Adapt(
			func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Service-Worker-Allowed", "/ims/")
				http.ServeFileFS(w, r, StaticFS, "static/sw.js")
			},
			CacheControl(cfg.Core.CacheControlShort),
		),
	)
	mux.Handle("GET /ims/app",
		AdaptTempl(template.Root(deployment, versionName, versionRef)),
	)
	mux.Handle("GET /ims/app/admin",
		AdaptTempl(template.AdminRoot(deployment, versionName, versionRef)),
	)
	mux.Handle("GET /ims/app/admin/events",
		AdaptTempl(template.AdminEvents(deployment, versionName, versionRef)),
	)
	mux.Handle("GET /ims/app/admin/actionlogs",
		AdaptTempl(template.AdminActionLogs(deployment, versionName, versionRef)),
	)
	mux.Handle("GET /ims/app/admin/types",
		AdaptTempl(template.AdminTypes(deployment, versionName, versionRef)),
	)
	mux.Handle("GET /ims/app/admin/outcomes",
		AdaptTempl(template.AdminOutcomes(deployment, versionName, versionRef)),
	)
	mux.Handle("GET /ims/app/admin/debug",
		AdaptTempl(template.AdminDebug(deployment, versionName, versionRef)),
	)
	// Areas: the global Admin doorway (event picker, eventName ""). The primary
	// doorway is the event-scoped page registered below; the same template serves
	// both, mirroring People. See docs/plans/68-feedback-round-6.md (6o).
	mux.Handle("GET /ims/app/admin/areas",
		AdaptTempl(template.AdminAreas(deployment, versionName, versionRef, "")),
	)
	mux.Handle("GET /ims/app/admin/people",
		AdaptTempl(template.People(deployment, versionName, versionRef, "", cfg.Core.DefaultPassword != "")),
	)
	mux.Handle("GET /ims/app/settings",
		AdaptTempl(template.Settings(deployment, versionName, versionRef)),
	)
	mux.HandleFunc("GET /ims/app/events/{eventName}/reports",
		func(w http.ResponseWriter, r *http.Request) {
			AdaptTempl(
				template.Reports(deployment, versionName, versionRef, r.PathValue("eventName")),
			).ServeHTTP(w, r)
		},
	)
	mux.HandleFunc("GET /ims/app/events/{eventName}/reports/{reportNumber}",
		func(w http.ResponseWriter, r *http.Request) {
			AdaptTempl(
				template.Report(deployment, versionName, versionRef, r.PathValue("eventName")),
			).ServeHTTP(w, r)
		},
	)
	mux.HandleFunc("GET /ims/app/events/{eventName}/incidents",
		func(w http.ResponseWriter, r *http.Request) {
			AdaptTempl(
				template.Incidents(deployment, versionName, versionRef, r.PathValue("eventName")),
			).ServeHTTP(w, r)
		},
	)
	mux.HandleFunc("GET /ims/app/events/{eventName}/incidents/{incidentNumber}",
		func(w http.ResponseWriter, r *http.Request) {
			AdaptTempl(
				template.Incident(deployment, versionName, versionRef, r.PathValue("eventName")),
			).ServeHTTP(w, r)
		},
	)
	mux.HandleFunc("GET /ims/app/events/{eventName}/visits",
		func(w http.ResponseWriter, r *http.Request) {
			AdaptTempl(
				template.SanctuaryVisits(deployment, versionName, versionRef, r.PathValue("eventName")),
			).ServeHTTP(w, r)
		},
	)
	mux.HandleFunc("GET /ims/app/events/{eventName}/visits/{visitNumber}",
		func(w http.ResponseWriter, r *http.Request) {
			AdaptTempl(
				template.SanctuaryVisit(deployment, versionName, versionRef, r.PathValue("eventName")),
			).ServeHTTP(w, r)
		},
	)
	// People registry, reached as an event-scoped page (the primary nav doorway).
	// The same template also serves the global Admin → People & Passwords doorway
	// above (eventName ""); see docs/plans/62-people-event-nav.md.
	mux.HandleFunc("GET /ims/app/events/{eventName}/people",
		func(w http.ResponseWriter, r *http.Request) {
			AdaptTempl(
				template.People(deployment, versionName, versionRef, r.PathValue("eventName"), cfg.Core.DefaultPassword != ""),
			).ServeHTTP(w, r)
		},
	)
	// Areas, reached as an event-scoped page (the primary nav doorway). The same
	// template also serves the global Admin → Event Areas doorway above
	// (eventName ""); see docs/plans/68-feedback-round-6.md (6o).
	mux.HandleFunc("GET /ims/app/events/{eventName}/areas",
		func(w http.ResponseWriter, r *http.Request) {
			AdaptTempl(
				template.AdminAreas(deployment, versionName, versionRef, r.PathValue("eventName")),
			).ServeHTTP(w, r)
		},
	)
	// Dashboard: a regular event-scoped page beside Incidents/Reports/Visits
	// (admin-only for now via the nav-link + page gates). See
	// docs/plans/70-dashboards.md.
	mux.HandleFunc("GET /ims/app/events/{eventName}/dashboard",
		func(w http.ResponseWriter, r *http.Request) {
			AdaptTempl(
				template.Dashboard(deployment, versionName, versionRef, r.PathValue("eventName")),
			).ServeHTTP(w, r)
		},
	)
	mux.HandleFunc("GET /ims/app/events/{eventName}",
		func(w http.ResponseWriter, r *http.Request) {
			ev := url.PathEscape(r.PathValue("eventName"))
			http.Redirect(w, r, "/ims/app/events/"+ev+"/incidents", http.StatusFound)
		},
	)

	mux.Handle("GET /ims/auth/login",
		AdaptTempl(template.Login(deployment, versionName, versionRef)),
	)
	mux.Handle("GET /ims/auth/logout",
		Adapt(
			func(w http.ResponseWriter, req *http.Request) {
				slog.Info("Redirecting from logout")
				http.SetCookie(w, &http.Cookie{
					Name:     authz.RefreshTokenCookieName,
					MaxAge:   -1,
					Path:     "/",
					HttpOnly: true,
					Secure:   true,
					SameSite: http.SameSiteStrictMode,
				})
				http.Redirect(w, req, "/ims/app?logout", http.StatusSeeOther)
			},
		),
	)

	// Catch-all handler. Requests to the above handlers with a trailing slash will get
	// a 404 response, so we redirect here instead.
	mux.HandleFunc("GET /ims/app/{anything...}", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") {
			// This makes really sure the resultant redirect will still be under /ims/app
			cleaned := path.Join("/", r.PathValue("anything"))
			if cleaned == "/" {
				cleaned = ""
			}
			// #nosec G710 // Open redirect via taint analysis
			http.Redirect(w, r, "/ims/app"+cleaned, http.StatusMovedPermanently)
			return
		}
		http.NotFound(w, r)
	})

	return mux
}

func CacheControl(maxAge time.Duration) Adapter {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			durSec := maxAge.Milliseconds() / 1000
			w.Header().Set("Cache-Control", fmt.Sprintf("max-age=%v", durSec))
			next.ServeHTTP(w, r)
		})
	}
}

// NoCache marks a response as always-revalidate ("Cache-Control: no-cache").
// The browser may store the response but must check with the origin before
// serving it, so an updated document (with new versioned asset URLs) is picked
// up on the next request rather than after the max-age expires. Used for the
// server-rendered HTML documents; the versioned static assets they reference
// keep their long cache.
func NoCache() Adapter {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-cache")
			next.ServeHTTP(w, r)
		})
	}
}

// CdnCacheControlOff prevents Cloudflare from caching a resource. An agent can still cache
// the file locally based on Cache-Control. This setting just stops Cloudflare from doing
// its additional level of caching.
//
// Prior to 2026-02, we used this Adapter on every handler serving IMS JavaScript files. Now
// that we append "?v=${gitRef}" to all requests for JS files, that should be unnecessary.
func CdnCacheControlOff() Adapter {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// https://developers.cloudflare.com/cache/concepts/cdn-cache-control/
			w.Header().Set("CDN-Cache-Control", "max-age=0, no-store")
			next.ServeHTTP(w, r)
		})
	}
}

type Adapter func(http.Handler) http.Handler

func Adapt(h http.HandlerFunc, adapters ...Adapter) http.Handler {
	handler := http.Handler(h)
	for i := range adapters {
		adapter := adapters[len(adapters)-1-i] // range in reverse
		handler = adapter(handler)
	}
	return handler
}

// AdaptTempl serves a server-rendered HTML document. HTML is sent with
// "Cache-Control: no-cache" so the browser always revalidates it before use.
// The document carries the "?v=${gitRef}" busters on our JS and CSS (see Head),
// so it MUST stay fresh — otherwise a returning user keeps a cached page that
// still points at the previous release's assets, and a new deploy only shows up
// after a manual hard refresh. The referenced JS/CSS keep their long cache: their
// URLs change every release, so caching them is both safe and desirable.
func AdaptTempl(comp templ.Component, adapters ...Adapter) http.Handler {
	adapters = append(adapters, NoCache())
	return Adapt(
		func(w http.ResponseWriter, req *http.Request) {
			err := comp.Render(req.Context(), w)
			if err != nil {
				slog.Error("Failed to render template", "error", err)
				herr.InternalServerError("Failed to parse template", err).From("[Render]").WriteResponse(w)
				return
			}
		},
		adapters...,
	)
}
