// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AccessForEventSchema,
  GetAuthStatusResponseSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  RefreshTokenResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import { ListEventsResponseSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/event_pb";
import { ChangeOwnPasswordResponseSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/profile_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";

// A programmable in-memory ImsService for createRouterTransport (plan 09l): the
// session RPCs with the server's semantics — Login issues an access token and
// either a body refresh token or the "cookie" (a field here, since there is no
// browser), RefreshToken applies body-wins-cookie-fallback, GetAuthStatus
// tolerates an anonymous caller, Logout clears the cookie — plus ListEvents as
// the representative authenticated data RPC. Behaviours flip a method into a
// failure mode so the transport and session tests can exercise every branch.

export type Behaviour = "ok" | "unauthenticated" | "unavailable";

export interface FakeUser {
  email: string;
  password: string;
  handle: string;
  personId: number;
  admin: boolean;
  /** Flipped false by a successful ChangeOwnPassword (plan 09n T2/T12). */
  usingDefaultPassword: boolean;
}

/** The minimal shape ListEvents needs — enough to build an Event via create(). */
export interface FakeEvent {
  id: number;
  name?: string;
}

export interface FakeCall {
  method: string;
  /** The Authorization header the call carried, or null. */
  bearer: string | null;
}

export interface FakeImsOptions {
  clock?: () => number;
  accessTtlMs?: number;
  user?: Partial<FakeUser>;
}

export interface FakeIms {
  routes(router: ConnectRouter): void;
  calls: FakeCall[];
  callsOf(method: string): FakeCall[];
  behaviour: {
    login: "ok" | "throttled";
    refresh: Behaviour;
    getAuthStatus: Behaviour;
    logout: "ok" | "unavailable";
    listEvents: Behaviour;
    changeOwnPassword: "ok" | "unavailable";
  };
  user: FakeUser;
  /** Programmable ListEvents data (plan 09n T12); default matches the previous hardcoded response. */
  events: FakeEvent[];
  /** The refresh "cookie" a web Login set and Logout clears. */
  cookieRefreshToken: string | undefined;
  /** Registers a valid refresh token (as if a Login had issued it) and returns it. */
  issueRefreshToken(): string;
  /** Every issued access token becomes invalid, as if it expired. */
  expireAccessTokens(): void;
  /** Every issued refresh token becomes invalid. */
  expireRefreshTokens(): void;
  /** Is this access token one the fake issued and still honours? */
  honours(accessToken: string | undefined): boolean;
}

export function createFakeIms(options: FakeImsOptions = {}): FakeIms {
  const clock = options.clock ?? Date.now;
  const accessTtlMs = options.accessTtlMs ?? 15 * 60 * 1000;
  const accessTokens = new Map<string, number>();
  const refreshTokens = new Set<string>();
  let counter = 0;

  const fake: FakeIms = {
    calls: [],
    callsOf: (method) => fake.calls.filter((c) => c.method === method),
    behaviour: {
      login: "ok",
      refresh: "ok",
      getAuthStatus: "ok",
      logout: "ok",
      listEvents: "ok",
      changeOwnPassword: "ok",
    },
    user: {
      email: "dee@example.org",
      password: "correct horse",
      handle: "Dee",
      personId: 42,
      admin: false,
      usingDefaultPassword: false,
      ...options.user,
    },
    events: [{ id: 1, name: "2026" }],
    cookieRefreshToken: undefined,
    issueRefreshToken() {
      counter += 1;
      const token = `refresh-${counter}`;
      refreshTokens.add(token);
      return token;
    },
    expireAccessTokens: () => accessTokens.clear(),
    expireRefreshTokens: () => refreshTokens.clear(),
    honours: (token) => {
      if (token === undefined) {
        return false;
      }
      const expiresAt = accessTokens.get(token);
      return expiresAt !== undefined && clock() < expiresAt;
    },
    routes(router) {
      router.service(ImsService, {
        login(req, ctx) {
          record("Login", ctx);
          if (fake.behaviour.login === "throttled") {
            throw new ConnectError(
              "too many failed login attempts, please wait and try again",
              Code.ResourceExhausted,
              { "Retry-After": "7" },
            );
          }
          if (
            req.email.toLowerCase() !== fake.user.email.toLowerCase() ||
            req.password !== fake.user.password
          ) {
            throw new ConnectError(
              "failed login attempt (bad credentials)",
              Code.Unauthenticated,
            );
          }
          const access = issueAccessToken();
          const refresh = fake.issueRefreshToken();
          if (req.returnRefreshToken) {
            return create(LoginResponseSchema, {
              ...access,
              refreshToken: refresh,
              refreshExpiresAt: timestampFromDate(
                new Date(clock() + 7 * 24 * 60 * 60 * 1000),
              ),
            });
          }
          fake.cookieRefreshToken = refresh;
          return create(LoginResponseSchema, access);
        },
        refreshToken(req, ctx) {
          record("RefreshToken", ctx);
          if (fake.behaviour.refresh === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (fake.behaviour.refresh === "unauthenticated") {
            throw new ConnectError(
              "failed to authenticate refresh token",
              Code.Unauthenticated,
            );
          }
          const token = req.refreshToken || fake.cookieRefreshToken;
          if (!token || !refreshTokens.has(token)) {
            throw new ConnectError(
              "failed to authenticate refresh token",
              Code.Unauthenticated,
            );
          }
          return create(RefreshTokenResponseSchema, issueAccessToken());
        },
        getAuthStatus(req, ctx) {
          record("GetAuthStatus", ctx);
          if (fake.behaviour.getAuthStatus === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            return create(GetAuthStatusResponseSchema, {
              authenticated: false,
            });
          }
          const eventAccess: Record<number, ReturnType<typeof accessFor>> = {};
          if (req.eventId !== undefined) {
            eventAccess[req.eventId] = accessFor(req.eventId);
          }
          return create(GetAuthStatusResponseSchema, {
            authenticated: true,
            user: fake.user.handle,
            personId: fake.user.personId,
            admin: fake.user.admin,
            canManagePersonnel: fake.user.admin,
            eventAccess,
            usingDefaultPassword: fake.user.usingDefaultPassword,
          });
        },
        logout(_req, ctx) {
          record("Logout", ctx);
          if (fake.behaviour.logout === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          fake.cookieRefreshToken = undefined;
          return create(LogoutResponseSchema);
        },
        listEvents(_req, ctx) {
          record("ListEvents", ctx);
          if (fake.behaviour.listEvents === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          return create(ListEventsResponseSchema, {
            events: fake.events,
          });
        },
        changeOwnPassword(req, ctx) {
          record("ChangeOwnPassword", ctx);
          if (fake.behaviour.changeOwnPassword === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          if (req.password.length < 8) {
            throw new ConnectError(
              "password must be at least 8 characters",
              Code.InvalidArgument,
            );
          }
          fake.user.usingDefaultPassword = false;
          return create(ChangeOwnPasswordResponseSchema);
        },
      });
    },
  };

  function issueAccessToken(): {
    token: string;
    expiresAt: ReturnType<typeof timestampFromDate>;
  } {
    counter += 1;
    const token = `access-${counter}`;
    const expiresAt = clock() + accessTtlMs;
    accessTokens.set(token, expiresAt);
    return { token, expiresAt: timestampFromDate(new Date(expiresAt)) };
  }

  function accessFor(eventId: number) {
    return create(AccessForEventSchema, {
      eventId,
      readIncidents: true,
      writeIncidents: fake.user.admin,
      readAreas: true,
    });
  }

  function record(method: string, ctx: HandlerContext): void {
    fake.calls.push({
      method,
      bearer: ctx.requestHeader.get("authorization"),
    });
  }

  function bearerOf(ctx: HandlerContext): string | undefined {
    const header = ctx.requestHeader.get("authorization");
    return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  }

  return fake;
}
