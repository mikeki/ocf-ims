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

import type { Transport } from "@connectrpc/connect";
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
  return { transport, bareTransport, client, tokens, refresher, session };
}
