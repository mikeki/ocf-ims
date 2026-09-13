// SPDX-License-Identifier: Apache-2.0

import type { Transport } from "@connectrpc/connect";
import type { Blobs, BlobsDeps } from "@/api/blobs";
import { createImsClient, type ImsClient } from "@/api/client";
import { createRefresher, type Refresher } from "@/api/refresh";
import { type AccessTokenCache, createAccessTokenCache } from "@/api/tokens";
import { createAuthInterceptor, type TransportFactory } from "@/api/transport";
import { createSession } from "@/session/session";
import type {
  RefreshTokenStore,
  Session,
  SessionPlatform,
} from "@/session/types";

// Wires the pieces in the one order that works (plan 09l F1): the token cache,
// the bare transport and the refresher on it, then the auth transport whose
// interceptor uses both, then the client and the session. The app composes
// this with connect-web (appRuntime.ts); tests compose it with
// createRouterTransport and a fake ImsService.

export interface RuntimeDeps {
  makeTransport: TransportFactory;
  store: RefreshTokenStore;
  platform: SessionPlatform;
  /** Runs on every sign-out (definitive refresh failure or the user's): clear the query caches. */
  onSignedOut?: () => Promise<void> | void;
  clock?: () => number;
  /** Builds the blob helper (09s) over the runtime's token cache and refresher. */
  makeBlobs?: (deps: Pick<BlobsDeps, "tokens" | "refresher">) => Blobs;
}

export interface Runtime {
  /** Every screen RPC: the auth interceptor. */
  transport: Transport;
  /** RefreshToken only: no interceptors. */
  bareTransport: Transport;
  client: ImsClient;
  tokens: AccessTokenCache;
  refresher: Refresher;
  session: Session;
  /** The attachment routes' helper; undefined when the runtime was built without one. */
  blobs: Blobs | undefined;
}

export function createRuntime(deps: RuntimeDeps): Runtime {
  const tokens = createAccessTokenCache(deps.clock);
  const bareTransport = deps.makeTransport([]);
  const bareClient = createImsClient(bareTransport);
  const refresher = createRefresher({
    refreshToken: (req) => bareClient.refreshToken(req),
    tokens,
    loadRefreshToken:
      deps.platform === "native"
        ? () => deps.store.load()
        : () => Promise.resolve(undefined),
  });
  const transport = deps.makeTransport([
    createAuthInterceptor({ tokens, refresher }),
  ]);
  const client = createImsClient(transport);
  const session = createSession({
    client,
    refresher,
    tokens,
    store: deps.store,
    platform: deps.platform,
    onSignedOut: deps.onSignedOut,
  });
  const blobs = deps.makeBlobs?.({ tokens, refresher });
  return {
    transport,
    bareTransport,
    client,
    tokens,
    refresher,
    session,
    blobs,
  };
}
