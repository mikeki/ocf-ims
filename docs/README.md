# Ranger IMS — local docs

A single-page reference for the Ranger IMS Go service: architecture, data model,
auth flow, and a dev-vs-prod comparison. Written to help a TS-fluent engineer
get oriented quickly.

## How to view

Just open the HTML file in a browser — no build step, no server needed:

```sh
xdg-open docs/index.html        # Linux
open docs/index.html            # macOS
```

Diagrams are rendered client-side with [Mermaid](https://mermaid.js.org/) pulled
from a CDN, so the page needs network access on first load.

## What's in there

- **Overview** — one-line mental model and the dependency surface.
- **Architecture** — system diagram with a toggle between production and the
  dev compose stack you have running locally.
- **Request flow** — sequence diagram from `ranger-demo.maybloom.tech` through
  Caddy into the Go service, plus the Caddy route table.
- **IMS database** — ER diagram and a filterable table reference covering every
  table in `store/schema/current.sql`.
- **People directory** — the local `PERSON`/`POSITION`/`TEAM` tables in the IMS
  database that back identity, credentials, and authz (replacing the former external
  Clubhouse directory; see `docs/plans/32-retire-clubhouse.md`).
- **Login flow** — sequence diagram for password verification and JWT minting.
- **Authorization model** — global roles, event-level roles, expression
  matchers, and a flowchart of the per-request decision.
- **Dev vs production** — side-by-side table of what changes.
- **Cheat sheet** — demo credentials, env vars, useful URL paths, and the
  commands you'll actually re-look-up.

## When to update

The doc is hand-written, not generated, so it drifts if you don't maintain it.
Things to refresh when the schema or model changes:

| Source file | Doc section to update |
|---|---|
| `store/schema/current.sql` | IMS database ER + table reference (incl. the local `PERSON`/`POSITION`/`TEAM` directory) |
| `lib/authz/permission.go` | Authorization model (roles, matchers, permissions) |
| `conf/imsconfig.go` | Cheat sheet env vars |
| `web/mux.go` / `api/mux.go` | URL path table |
| `docker-compose.dev.yml` / `Caddyfile` | Dev architecture + cheat sheet commands |

## What this doc deliberately doesn't cover

- API endpoint reference (the source is the authoritative list)
- Migration tooling internals
- The TypeScript / templ frontend
- Production deployment specifics outside this demo (the real BM Rangers setup)
