# 09g — Interceptor spine (slice 1b)

> **Status:** Plan — implemented on `feat/1b-interceptor-spine`
> **Parent:** [09-proto-connect-platform.md](09-proto-connect-platform.md) (Phase 1)
> **Follows:** [09f-server-restructure.md](09f-server-restructure.md) (slice 1a)
> **Last updated:** 2026-08-30

## Objective

Slice 1a made the ground ready (module at `go/`, handlers in `internal/<domain>/`)
and retired the transport risk with a throwaway spike. **1b lands the spine for
real:** the cross-cutting behaviour every RPC needs — request id, structured
logging, panic recovery, auth, **protovalidate**, and the **action log** —
declared **once** and **on by default** (M9, M5), with the ImsService Connect
handler registered on the existing mux beside `AddToMux`. One RPC is implemented
end-to-end to prove the chain through the generated client.

This is behaviour-additive: the REST tier is untouched and stays live and frozen
(M13). The Connect surface answers exactly one method for now; the other 59 are
filled in across 1c/1d.

## What lands

| Piece | Where |
|---|---|
| Six interceptor constructors + `Interceptors()` assembler | `go/internal/server/interceptors.go` (leaf) |
| `ImsService` handler (embeds `Unimplemented…`), `GetAuthStatus`, `AddConnectToMux` | `go/api/connect.go` (wiring, beside `AddToMux`) |
| Registration on the shared mux | `go/cmd/serve.go` (`api.AddConnectToMux` next to `api.AddToMux`) |
| `connectrpc.com/validate` promoted to a direct dependency | `go/go.mod` |
| `idempotency_level = NO_SIDE_EFFECTS` on `GetAuthStatus` | `proto/…/service/v1/service.proto` |
| End-to-end tests through the generated client + interceptor unit tests | `go/api/connect_test.go`, `go/internal/server/interceptors_test.go` |

**The chain (outermost → innermost):** Recovery, RequestID, Auth, Slog,
ActionLog, Validate. Order is load-bearing — see the doc comment on
`Interceptors()`. Validate is innermost so a constraint violation is rejected
right before the handler; the action log sits *outside* Validate so a rejected
request is still audited as an attempt; Auth is outside the two things that read
the caller (slog, action log).

Each interceptor mirrors an existing REST adapter so the transports behave
identically while both live: `NewAuthInterceptor` ≈ `OptionalAuthN`,
`NewActionLogInterceptor` ≈ `LogRequest`, `NewRecoveryInterceptor` ≈
`RecoverFromPanic`. Both tiers store the same `JWTContext` under the same key, so
one `ClaimsFromContext` accessor serves handlers on either side.

## Decisions (resolved here; flagged for review)

1. **`Unimplemented…` embedding is a tracked scaffold, not spike-only.** The
   Step-0 note said the embedding was "only allowed in the spike/tests." Relaxing
   that for 1b–1d is deliberate: it is the idiomatic connect-go way to stand up a
   partial service, and 59 hand-written `CodeUnimplemented` stubs would be pure
   churn that 1c/1d delete method-by-method. The real enforcement is the **Phase-1
   exit gate**, which greps for the embedding — so it *cannot* ship. The struct
   comment says so in as many words.
2. **Auth is populate-only (mirrors `OptionalAuthN`), not a gate.** Interceptors
   are global; Login / RefreshToken / GetAuthStatus tolerate anonymous callers.
   So the interceptor verifies-if-present and populates claims; each handler
   asserts the identity it needs and returns `CodeUnauthenticated` itself. This
   matches today's REST mix of `RequireAuthN`/`OptionalAuthN` without a per-method
   annotation.
3. **Action log is default-on, keyed off the contract.** M9's whole point is that
   default-on removes the "easy to omit" footgun. The read/write signal is
   **`idempotency_level = NO_SIDE_EFFECTS`** in the proto: the interceptor audits
   every RPC *except* those marked no-side-effects. This is scoped tightly for 1b
   — only `GetAuthStatus` (the one implemented + tested read) carries the marker;
   the remaining reads earn it as they land in 1d. The default **fails safe**: an
   un-annotated read is merely over-logged, never a *missed* mutation.
4. **Homes.** The interceptors live in the leaf `internal/server` (they need only
   `authz`/`actionlog`/`directory`/`imsdb`, no domain). The ImsService impl lives
   in `api`, beside `AddToMux`, because — like `AddToMux` — it will aggregate every
   domain once its methods become shims in 1d. `AddConnectToMux` takes the
   `server.ActionLogger` *interface* (the concrete `*actionlog.Logger` satisfies
   it) so a spy can prove the audit split in a DB-free test.
5. **Proof RPC = `GetAuthStatus`** (identity subset from JWT claims). It exercises
   the auth interceptor directly; protovalidate is proven independently via an
   invalid `Login` (rejected before its still-unimplemented handler runs). The
   viewer-derived remainder of the whoami (event access, vapid key,
   using-default-password) is 1d, left zero-valued and documented, not forgotten.

**On `buf breaking`:** adding `idempotency_level` is reported by `buf breaking` as
an option change. It is not wire-breaking (a retry-safety hint, and a *widening*
one), the contract has no shipped clients, and CI runs only `buf lint` (clean).
Expected during pre-release contract development.

## Verification gate (1b)

- [x] `go build ./...`, `go vet ./...`, `gofmt` clean.
- [x] `go test ./...` green; golangci-lint 0 issues on the changed packages.
- [x] End-to-end through the **generated client**: GetAuthStatus answers
      authenticated/anonymous; an invalid Login is rejected `invalid_argument`; a
      valid-but-unimplemented Login returns `unimplemented`; a mutation is audited
      and a `NO_SIDE_EFFECTS` read is not.
- [x] Interceptor unit tests: recovery → `internal`, request-id mint/adopt+echo,
      auth populate/anonymous.
- [x] `go run bin/build/build.go` regenerates and compiles; `buf lint` clean.
- [x] `go test ./api/integration ./store/integration` green (REST path unchanged).

## Findings queued for the §7 upstream log

Appended to [09 §7](09-proto-connect-platform.md) as the slice lands (M14).

- **The interceptor chain maps cleanly onto the REST adapters** — the order is the
  design, and a leaf `internal/server` can hold the whole spine because none of it
  needs a domain package.
- **"Declared once, on by default" needs a read/write signal, and the contract is
  the right place for it** (`idempotency_level`), so the action log's default-on
  policy is declarative and fails safe.
- **Testing the audit split needs the real `req.Spec()`** — a hand-built
  `connect.NewRequest` has an empty spec, so the idempotency branch is proven
  end-to-end through the generated handler with an injected spy sink, not in a
  pure unit test.
