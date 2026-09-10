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

import { Code, ConnectError } from "@connectrpc/connect";
import { PROACTIVE_REFRESH_WINDOW_MS } from "@/api/transport";
import { createFakeIms } from "@/test/fakeIms";
import { createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The E3 interceptor (plan 09l F2–F4), through createRouterTransport: no
// server, no network, a programmable fake ImsService.

const ACCESS_TTL_MS = 15 * 60 * 1000;

function setup() {
  let now = 1_700_000_000_000;
  const clock = () => now;
  const fake = createFakeIms({ clock, accessTtlMs: ACCESS_TTL_MS });
  const store = createMemoryRefreshTokenStore();
  const runtime = createTestRuntime({ fake, store, platform: "native", clock });
  return {
    fake,
    store,
    runtime,
    advance: (ms: number) => {
      now += ms;
    },
    signIn: () => runtime.session.signIn(fake.user.email, fake.user.password),
    methods: () => fake.calls.map((c) => c.method),
  };
}

describe("the auth interceptor", () => {
  it("attaches the cached Bearer to a data RPC and none to Login", async () => {
    const t = setup();
    await t.signIn();
    const token = t.runtime.tokens.get()?.token;
    expect(token).toBeDefined();

    await t.runtime.client.listEvents({});

    expect(t.fake.callsOf("Login")[0]?.bearer).toBeNull();
    expect(t.fake.callsOf("ListEvents")[0]?.bearer).toBe(`Bearer ${token}`);
    expect(t.fake.callsOf("RefreshToken")).toHaveLength(0);
  });

  it("refreshes proactively when the token is within 60 s of expiry", async () => {
    const t = setup();
    await t.signIn();
    const before = t.runtime.tokens.get()?.token;
    t.advance(ACCESS_TTL_MS - PROACTIVE_REFRESH_WINDOW_MS + 1);

    await t.runtime.client.listEvents({});

    const after = t.runtime.tokens.get()?.token;
    expect(after).not.toBe(before);
    expect(t.methods()).toEqual([
      "Login",
      "GetAuthStatus",
      "RefreshToken",
      "ListEvents",
    ]);
    expect(t.fake.callsOf("RefreshToken")[0]?.bearer).toBeNull();
    expect(t.fake.callsOf("ListEvents")[0]?.bearer).toBe(`Bearer ${after}`);
  });

  it("does not refresh proactively while the token has more than 60 s left", async () => {
    const t = setup();
    await t.signIn();
    t.advance(ACCESS_TTL_MS - PROACTIVE_REFRESH_WINDOW_MS - 1000);

    await t.runtime.client.listEvents({});

    expect(t.fake.callsOf("RefreshToken")).toHaveLength(0);
  });

  it("on Unauthenticated, refreshes once and retries the call once with the new token", async () => {
    const t = setup();
    await t.signIn();
    const stale = t.runtime.tokens.get()?.token;
    t.fake.expireAccessTokens();

    const resp = await t.runtime.client.listEvents({});

    expect(resp.events).toHaveLength(1);
    expect(t.methods()).toEqual([
      "Login",
      "GetAuthStatus",
      "ListEvents",
      "RefreshToken",
      "ListEvents",
    ]);
    const [first, retry] = t.fake.callsOf("ListEvents");
    expect(first?.bearer).toBe(`Bearer ${stale}`);
    expect(retry?.bearer).toBe(`Bearer ${t.runtime.tokens.get()?.token}`);
    expect(retry?.bearer).not.toBe(first?.bearer);
  });

  it("single-flight: concurrent Unauthenticated calls share one refresh", async () => {
    const t = setup();
    await t.signIn();
    t.fake.expireAccessTokens();

    await Promise.all([
      t.runtime.client.listEvents({}),
      t.runtime.client.listEvents({}),
      t.runtime.client.listEvents({}),
    ]);

    expect(t.fake.callsOf("RefreshToken")).toHaveLength(1);
    expect(t.fake.callsOf("ListEvents")).toHaveLength(6);
  });

  it("a definitive Unauthenticated from RefreshToken signs out: cache, store and session", async () => {
    const t = setup();
    await t.signIn();
    expect(t.store.value).toBeDefined();
    t.fake.expireAccessTokens();
    t.fake.expireRefreshTokens();

    await expect(t.runtime.client.listEvents({})).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });

    expect(t.runtime.tokens.get()).toBeUndefined();
    expect(t.store.value).toBeUndefined();
    expect(t.runtime.session.getState()).toEqual({ status: "signedOut" });
    // One refresh, no second retry.
    expect(t.methods()).toEqual([
      "Login",
      "GetAuthStatus",
      "ListEvents",
      "RefreshToken",
    ]);
  });

  it("a transient RefreshToken failure keeps the session and surfaces the original error", async () => {
    const t = setup();
    await t.signIn();
    const token = t.runtime.tokens.get();
    t.fake.expireAccessTokens();
    t.fake.behaviour.refresh = "unavailable";

    await expect(t.runtime.client.listEvents({})).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });

    expect(t.runtime.tokens.get()).toEqual(token);
    expect(t.store.value).toBeDefined();
    expect(t.runtime.session.getState().status).toBe("signedIn");

    // And once the server is back, the next call heals itself.
    t.fake.behaviour.refresh = "ok";
    await expect(t.runtime.client.listEvents({})).resolves.toBeDefined();
    expect(t.runtime.session.getState().status).toBe("signedIn");
  });

  it("does not treat Login's Unauthenticated (bad credentials) as an expired token", async () => {
    const t = setup();

    await expect(
      t.runtime.client.login({ email: t.fake.user.email, password: "nope" }),
    ).rejects.toBeInstanceOf(ConnectError);

    expect(t.methods()).toEqual(["Login"]);
  });

  it("passes other errors through untouched", async () => {
    const t = setup();
    await t.signIn();
    t.fake.behaviour.listEvents = "unavailable";

    await expect(t.runtime.client.listEvents({})).rejects.toMatchObject({
      code: Code.Unavailable,
    });
    expect(t.fake.callsOf("RefreshToken")).toHaveLength(0);
  });
});
