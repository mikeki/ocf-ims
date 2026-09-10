// SPDX-License-Identifier: Apache-2.0

import { isAppError } from "@/api/errors";
import type { SessionPlatform } from "@/session/types";
import { createFakeIms } from "@/test/fakeIms";
import { createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The session state machine (plan 09l F5–F8) on both platforms.

function setup(platform: SessionPlatform, storedToken?: string) {
  const fake = createFakeIms();
  const store = createMemoryRefreshTokenStore(storedToken);
  const signedOut = jest.fn();
  const runtime = createTestRuntime({
    fake,
    store,
    platform,
    onSignedOut: signedOut,
  });
  return {
    fake,
    store,
    signedOut,
    runtime,
    session: runtime.session,
    methods: () => fake.calls.map((c) => c.method),
  };
}

describe("bootstrap", () => {
  it("native: a stored refresh token resumes the session", async () => {
    const fake = createFakeIms();
    const t = setup("native", fake.issueRefreshToken());
    t.runtime.fake.calls.length = 0;
    // The token was issued by a different fake instance; re-register it here.
    const token = t.store.value;
    t.fake.expireRefreshTokens();
    t.store.value = t.fake.issueRefreshToken();
    expect(token).toBeDefined();

    await t.session.bootstrap();

    expect(t.session.getState()).toMatchObject({
      status: "signedIn",
      auth: { authenticated: true, user: "Dee", personId: 42 },
    });
    expect(t.methods()).toEqual(["RefreshToken", "GetAuthStatus"]);
    expect(t.runtime.tokens.get()).toBeDefined();
  });

  it("native: no stored token means signed out, without a request", async () => {
    const t = setup("native");

    await t.session.bootstrap();

    expect(t.session.getState()).toEqual({ status: "signedOut" });
    expect(t.methods()).toEqual([]);
  });

  it("native: an expired stored token is wiped and the session is signed out", async () => {
    const t = setup("native", "refresh-stale");

    await t.session.bootstrap();

    expect(t.session.getState()).toEqual({ status: "signedOut" });
    expect(t.store.value).toBeUndefined();
    expect(t.methods()).toEqual(["RefreshToken"]);
  });

  it("web: the cookie resumes the session", async () => {
    const t = setup("web");
    t.fake.cookieRefreshToken = t.fake.issueRefreshToken();

    await t.session.bootstrap();

    expect(t.session.getState()).toMatchObject({ status: "signedIn" });
    expect(t.methods()).toEqual(["RefreshToken", "GetAuthStatus"]);
  });

  it("web: no cookie means one quiet RefreshToken and signed out", async () => {
    const t = setup("web");

    await t.session.bootstrap();

    expect(t.session.getState()).toEqual({ status: "signedOut" });
    expect(t.methods()).toEqual(["RefreshToken"]);
    expect(t.store.clears).toBe(1);
  });

  it("a server that cannot be reached is `unreachable`, and retry recovers", async () => {
    const t = setup("web");
    t.fake.cookieRefreshToken = t.fake.issueRefreshToken();
    t.fake.behaviour.refresh = "unavailable";

    await t.session.bootstrap();

    const state = t.session.getState();
    expect(state.status).toBe("unreachable");
    if (state.status === "unreachable") {
      expect(state.error.kind).toBe("unavailable");
      expect(state.error.retryable).toBe(true);
    }
    expect(t.signedOut).not.toHaveBeenCalled();

    t.fake.behaviour.refresh = "ok";
    await t.session.bootstrap();
    expect(t.session.getState().status).toBe("signedIn");
  });

  it("a whoami that cannot be reached is `unreachable` too, with the token kept", async () => {
    const t = setup("web");
    t.fake.cookieRefreshToken = t.fake.issueRefreshToken();
    t.fake.behaviour.getAuthStatus = "unavailable";

    await t.session.bootstrap();

    expect(t.session.getState().status).toBe("unreachable");
    expect(t.runtime.tokens.get()).toBeDefined();
  });

  it("is idempotent while signed in", async () => {
    const t = setup("web");
    t.fake.cookieRefreshToken = t.fake.issueRefreshToken();
    await t.session.bootstrap();
    const calls = t.methods().length;

    await t.session.bootstrap();

    expect(t.methods()).toHaveLength(calls);
  });

  it("notifies subscribers on every transition", async () => {
    const t = setup("web");
    const seen: string[] = [];
    t.session.subscribe(() => seen.push(t.session.getState().status));

    await t.session.bootstrap();

    expect(seen).toEqual(["unknown", "signedOut"]);
  });
});

describe("signIn", () => {
  it("native asks for a body refresh token and stores only that", async () => {
    const t = setup("native");

    await t.session.signIn(t.fake.user.email, t.fake.user.password);

    expect(t.session.getState()).toMatchObject({
      status: "signedIn",
      auth: { user: "Dee" },
    });
    expect(t.store.saves).toBe(1);
    expect(t.store.value).toMatch(/^refresh-/);
    expect(t.fake.cookieRefreshToken).toBeUndefined();
    expect(t.methods()).toEqual(["Login", "GetAuthStatus"]);
  });

  it("web leaves the refresh token to the cookie and stores nothing", async () => {
    const t = setup("web");

    await t.session.signIn(t.fake.user.email, t.fake.user.password);

    expect(t.session.getState().status).toBe("signedIn");
    expect(t.store.saves).toBe(0);
    expect(t.fake.cookieRefreshToken).toMatch(/^refresh-/);
  });

  it("wrong credentials throw an `unauthenticated` AppError and leave the session signed out", async () => {
    const t = setup("native");
    await t.session.bootstrap();

    const err = await t.session.signIn(t.fake.user.email, "nope").then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(isAppError(err)).toBe(true);
    if (isAppError(err)) {
      expect(err.kind).toBe("unauthenticated");
    }
    expect(t.session.getState()).toEqual({ status: "signedOut" });
    expect(t.store.saves).toBe(0);
    expect(t.runtime.tokens.get()).toBeUndefined();
  });

  it("a throttled login throws `throttled` with the Retry-After seconds", async () => {
    const t = setup("native");
    t.fake.behaviour.login = "throttled";

    const err = await t.session
      .signIn(t.fake.user.email, t.fake.user.password)
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(isAppError(err)).toBe(true);
    if (isAppError(err)) {
      expect(err.kind).toBe("throttled");
      expect(err.retryAfterSeconds).toBe(7);
    }
  });

  it("a whoami failure after a good login is `unreachable` with the token kept, and throws", async () => {
    const t = setup("native");
    t.fake.behaviour.getAuthStatus = "unavailable";

    const err = await t.session
      .signIn(t.fake.user.email, t.fake.user.password)
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(isAppError(err)).toBe(true);
    expect(t.session.getState().status).toBe("unreachable");
    expect(t.store.value).toBeDefined();

    // Retry resumes from the stored token.
    t.fake.behaviour.getAuthStatus = "ok";
    await t.session.bootstrap();
    expect(t.session.getState().status).toBe("signedIn");
  });
});

describe("signOut", () => {
  it("is local-first: clears the cache, the store and the query caches, then tells the server with the Bearer", async () => {
    const t = setup("native");
    await t.session.signIn(t.fake.user.email, t.fake.user.password);
    const token = t.runtime.tokens.get()?.token;

    await t.session.signOut();

    expect(t.session.getState()).toEqual({ status: "signedOut" });
    expect(t.runtime.tokens.get()).toBeUndefined();
    expect(t.store.value).toBeUndefined();
    expect(t.signedOut).toHaveBeenCalledTimes(1);
    expect(t.fake.callsOf("Logout")[0]?.bearer).toBe(`Bearer ${token}`);
  });

  it("web: the server clears the cookie", async () => {
    const t = setup("web");
    await t.session.signIn(t.fake.user.email, t.fake.user.password);
    expect(t.fake.cookieRefreshToken).toBeDefined();

    await t.session.signOut();

    expect(t.fake.cookieRefreshToken).toBeUndefined();
    expect(t.session.getState()).toEqual({ status: "signedOut" });
  });

  it("still signs out locally when Logout cannot reach the server", async () => {
    const t = setup("native");
    await t.session.signIn(t.fake.user.email, t.fake.user.password);
    t.fake.behaviour.logout = "unavailable";

    await expect(t.session.signOut()).resolves.toBeUndefined();

    expect(t.session.getState()).toEqual({ status: "signedOut" });
    expect(t.store.value).toBeUndefined();
    expect(t.signedOut).toHaveBeenCalledTimes(1);
  });
});

describe("refreshAuthStatus", () => {
  it("re-reads GetAuthStatus while signed in", async () => {
    const t = setup("native");
    await t.session.signIn(t.fake.user.email, t.fake.user.password);
    expect(t.session.getState()).toMatchObject({ auth: { admin: false } });

    t.fake.user.admin = true;
    await t.session.refreshAuthStatus();

    expect(t.session.getState()).toMatchObject({ auth: { admin: true } });
  });

  it("does nothing while signed out", async () => {
    const t = setup("native");
    await t.session.bootstrap();

    await t.session.refreshAuthStatus();

    expect(t.methods()).toEqual([]);
  });
});
