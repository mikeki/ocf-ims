// SPDX-License-Identifier: Apache-2.0

import type { Interceptor, Transport } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { Refresher } from "@/api/refresh";
import type { AccessTokenCache } from "@/api/tokens";

// The E3 transport (plan 09l F1–F3): one interceptor adds `Authorization:
// Bearer` from the synchronous token cache, refreshes proactively when the
// token is about to expire, and on an Unauthenticated answer refreshes once
// (single-flight) and retries the unary call once.
//
// Session RPCs are exempt from the refresh-and-retry logic — Login's
// Unauthenticated means "bad credentials", not "expired token" — and Login /
// RefreshToken never carry a Bearer. Logout does, so the server can log and
// audit who signed out. RefreshToken itself never reaches this interceptor:
// the Refresher calls it on the bare transport.

/** How close to `expires_at` a token may get before a call refreshes it first. */
export const PROACTIVE_REFRESH_WINDOW_MS = 60_000;

const SESSION_RPCS: ReadonlySet<string> = new Set([
  "Login",
  "RefreshToken",
  "Logout",
]);
const NO_BEARER_RPCS: ReadonlySet<string> = new Set(["Login", "RefreshToken"]);

export interface AuthInterceptorDeps {
  tokens: AccessTokenCache;
  refresher: Refresher;
  proactiveWindowMs?: number;
}

export function createAuthInterceptor(deps: AuthInterceptorDeps): Interceptor {
  const window = deps.proactiveWindowMs ?? PROACTIVE_REFRESH_WINDOW_MS;

  const attachBearer = (header: Headers): void => {
    const current = deps.tokens.get();
    if (current) {
      header.set("Authorization", `Bearer ${current.token}`);
    } else {
      header.delete("Authorization");
    }
  };

  return (next) => async (req) => {
    const rpc = req.method.name;
    if (SESSION_RPCS.has(rpc)) {
      if (!NO_BEARER_RPCS.has(rpc)) {
        attachBearer(req.header);
      }
      return next(req);
    }

    if (deps.tokens.expiringWithin(window)) {
      // Outcome deliberately ignored: `signedOut` already cleared the cache
      // (the call goes out anonymous and the server answers), and `failed`
      // keeps the current token, which may well still be accepted.
      await deps.refresher.refresh();
    }
    attachBearer(req.header);
    try {
      return await next(req);
    } catch (e) {
      const err = ConnectError.from(e);
      // Only a unary request can be replayed; a stream's body is an iterator
      // that was already consumed.
      if (err.code !== Code.Unauthenticated || req.stream) {
        throw err;
      }
      const outcome = await deps.refresher.refresh();
      if (outcome.kind !== "refreshed") {
        throw err;
      }
      attachBearer(req.header);
      return next(req);
    }
  };
}

/** Builds a transport from a list of interceptors — the seam that lets tests substitute createRouterTransport. */
export type TransportFactory = (interceptors: Interceptor[]) => Transport;

export interface ConnectTransportConfig {
  baseUrl: string;
  useBinaryFormat: boolean;
  fetch?: typeof globalThis.fetch;
}

/**
 * The production factory (09l F13): connect-web, and a fetch override that
 * sends credentials on every request — connect-web v2 dropped the
 * `credentials` option — so the web refresh cookie flows cross-origin in dev
 * (3a.0 CORS) and same-origin in production. Native never receives a cookie:
 * `return_refresh_token` suppresses it (09j).
 */
export function createConnectTransportFactory(
  config: ConnectTransportConfig,
): TransportFactory {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return (interceptors) =>
    createConnectTransport({
      baseUrl: config.baseUrl,
      useBinaryFormat: config.useBinaryFormat,
      interceptors,
      fetch: (input, init) =>
        fetchImpl(input, { ...init, credentials: "include" }),
    });
}
