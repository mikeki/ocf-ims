// SPDX-License-Identifier: Apache-2.0

import type { GetAuthStatusResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import type { ImsClient } from "@/api/client";
import { toAppError } from "@/api/errors";
import type { Refresher } from "@/api/refresh";
import { type AccessTokenCache, accessTokenFrom } from "@/api/tokens";
import type {
  RefreshTokenStore,
  Session,
  SessionPlatform,
  SessionState,
} from "@/session/types";

// The session state machine (plan 09l F5–F8):
//
//   unknown ──bootstrap──▶ signedIn { auth }
//      │                      ▲   │
//      ├──▶ signedOut ──signIn┘   └──signOut / definitive refresh failure──▶ signedOut
//      └──▶ unreachable ──retry (bootstrap)──▶ …
//
// Bootstrap refreshes with what the device holds — the stored refresh token on
// native, the HttpOnly cookie on web — and then asks GetAuthStatus who we are.
// Only a definitive Unauthenticated from RefreshToken ends the session; a
// server that cannot be reached leaves it `unreachable`, never signed out
// (#189). Sign-out is local-first and cannot fail.

export interface SessionDeps {
  /** On the auth transport. */
  client: ImsClient;
  refresher: Refresher;
  tokens: AccessTokenCache;
  store: RefreshTokenStore;
  platform: SessionPlatform;
  /** Clear the query caches; runs on every sign-out. */
  onSignedOut?: () => Promise<void> | void;
  /** Runs before the user's sign-out reaches the server, while the Bearer is still good (push unregistration, 09u). Bounded; best-effort. */
  beforeSignOut?: () => Promise<void>;
}

/** How long beforeSignOut may hold the sign-out. */
export const BEFORE_SIGN_OUT_MS = 3_000;

export function createSession(deps: SessionDeps): Session {
  let state: SessionState = { status: "unknown" };
  const listeners = new Set<() => void>();

  function setState(next: SessionState): void {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  /**
   * Ends the session on this device: the access token, the stored refresh
   * token, the caches, the state. Every step is best-effort so the sign-out
   * always completes. Single-flight: the refresher's listener and bootstrap /
   * signOut may both ask, and share one run.
   */
  let ending: Promise<void> | undefined;
  /** The most recent end, for a caller that knows the refresher just triggered one. */
  let lastEnd: Promise<void> = Promise.resolve();
  function endLocally(): Promise<void> {
    if (ending === undefined) {
      ending = runEnd().finally(() => {
        ending = undefined;
      });
      lastEnd = ending;
    }
    return ending;
  }

  async function runEnd(): Promise<void> {
    deps.tokens.clear();
    try {
      await deps.store.clear();
    } catch {
      // A store that cannot be cleared keeps a token that no longer refreshes; nothing more to do here.
    }
    try {
      await deps.onSignedOut?.();
    } catch {
      // The caches are a convenience; the sign-out stands.
    }
    setState({ status: "signedOut" });
  }

  // A refresh anywhere (the interceptor's reactive or proactive path) that
  // answers a definitive Unauthenticated ends the session here too.
  deps.refresher.onSignedOut(() => {
    void endLocally();
  });

  async function loadStatus(): Promise<void> {
    let auth: GetAuthStatusResponse;
    try {
      auth = await deps.client.getAuthStatus({});
    } catch (e) {
      const error = toAppError(e);
      if (error.kind === "unauthenticated") {
        await endLocally();
        return;
      }
      setState({ status: "unreachable", error });
      return;
    }
    if (!auth.authenticated) {
      // The server saw no valid token behind our Bearer: not a session.
      await endLocally();
      return;
    }
    setState({ status: "signedIn", auth });
  }

  async function bootstrap(): Promise<void> {
    if (state.status === "signedIn") {
      return;
    }
    setState({ status: "unknown" });
    if (deps.platform === "native") {
      let stored: string | undefined;
      try {
        stored = await deps.store.load();
      } catch {
        // A secure store that cannot be read holds nothing we can use.
        stored = undefined;
      }
      if (!stored) {
        setState({ status: "signedOut" });
        return;
      }
    }
    const outcome = await deps.refresher.refresh();
    switch (outcome.kind) {
      case "signedOut":
        // The refresher already notified our listener (synchronously, before
        // answering); wait for that end rather than starting a second one.
        await lastEnd;
        return;
      case "failed":
        setState({ status: "unreachable", error: toAppError(outcome.error) });
        return;
      case "refreshed":
        await loadStatus();
        return;
    }
  }

  async function signIn(email: string, password: string): Promise<void> {
    let resp: Awaited<ReturnType<ImsClient["login"]>>;
    try {
      resp = await deps.client.login({
        email,
        password,
        returnRefreshToken: deps.platform === "native",
      });
    } catch (e) {
      throw toAppError(e);
    }
    if (deps.platform === "native") {
      // Stored before the whoami so a crash between the two leaves a session
      // the next launch can resume.
      try {
        await deps.store.save(resp.refreshToken);
      } catch (e) {
        throw toAppError(e);
      }
    }
    deps.tokens.set(accessTokenFrom(resp));
    let auth: GetAuthStatusResponse;
    try {
      auth = await deps.client.getAuthStatus({});
    } catch (e) {
      // Signed in as far as the server is concerned, but we do not know who we
      // are yet; Retry bootstraps from the stored token / the cookie.
      const error = toAppError(e);
      setState({ status: "unreachable", error });
      throw error;
    }
    setState({ status: "signedIn", auth });
  }

  async function signOut(): Promise<void> {
    if (deps.beforeSignOut) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        deps.beforeSignOut().catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, BEFORE_SIGN_OUT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
    // Tell the server first, with the Bearer passed explicitly so the audit
    // line carries the handle whatever the interceptor's timing; the promise is
    // awaited last so a slow network never delays the local sign-out.
    const current = deps.tokens.get();
    const logout = deps.client
      .logout(
        {},
        current
          ? { headers: { Authorization: `Bearer ${current.token}` } }
          : undefined,
      )
      .then(
        () => undefined,
        () => undefined,
      );
    await endLocally();
    await logout;
  }

  async function refreshAuthStatus(): Promise<void> {
    if (state.status !== "signedIn") {
      return;
    }
    let auth: GetAuthStatusResponse;
    try {
      auth = await deps.client.getAuthStatus({});
    } catch {
      // Keep what we know; a definitive sign-out would have come through the refresher.
      return;
    }
    if (auth.authenticated) {
      setState({ status: "signedIn", auth });
    } else {
      await endLocally();
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    bootstrap,
    signIn,
    signOut,
    refreshAuthStatus,
  };
}
