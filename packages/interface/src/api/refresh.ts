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
import type { RefreshTokenResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import {
  type AccessToken,
  type AccessTokenCache,
  accessTokenFrom,
} from "@/api/tokens";

// Single-flight refresh (plan 09l F4). Every caller that needs a new access
// token — the interceptor's proactive and reactive paths, the session's
// bootstrap — shares one in-flight RefreshToken call. The refresh goes through
// the BARE transport (no auth interceptor, F1): a refresh must never recurse
// into the interceptor that asked for it.
//
// The security decision of the slice is classifyRefreshError: ONLY an
// Unauthenticated answer from RefreshToken itself ends the session. Anything
// else — no network, Unavailable, a 5xx while the server redeploys, a 404 from
// a proxy — is transient: the cached access token and the stored refresh token
// stay, and the caller sees its original error (the lesson of #189: a redeploy
// must not log the fair out).

export type RefreshOutcome =
  | { readonly kind: "refreshed"; readonly token: AccessToken }
  | { readonly kind: "signedOut"; readonly error: ConnectError }
  | { readonly kind: "failed"; readonly error: ConnectError };

export interface Refresher {
  refresh(): Promise<RefreshOutcome>;
  /** Fires once per definitive sign-out (a `signedOut` outcome). */
  onSignedOut(listener: (error: ConnectError) => void): () => void;
}

export interface RefresherDeps {
  /** RefreshToken on the bare transport (no interceptors). */
  refreshToken(req: { refreshToken: string }): Promise<RefreshTokenResponse>;
  tokens: AccessTokenCache;
  /**
   * The stored refresh token to send in the body. Native reads SecureStore;
   * web returns undefined and the HttpOnly cookie rides along instead.
   */
  loadRefreshToken(): Promise<string | undefined>;
}

export function classifyRefreshError(
  error: ConnectError,
): "signedOut" | "failed" {
  return error.code === Code.Unauthenticated ? "signedOut" : "failed";
}

export function createRefresher(deps: RefresherDeps): Refresher {
  const listeners = new Set<(error: ConnectError) => void>();
  let inflight: Promise<RefreshOutcome> | undefined;

  async function run(): Promise<RefreshOutcome> {
    let stored: string | undefined;
    try {
      stored = await deps.loadRefreshToken();
    } catch (e) {
      // A storage failure is transient, not a sign-out.
      return { kind: "failed", error: ConnectError.from(e, Code.Unavailable) };
    }
    try {
      const resp = await deps.refreshToken({ refreshToken: stored ?? "" });
      const token = accessTokenFrom(resp);
      deps.tokens.set(token);
      return { kind: "refreshed", token };
    } catch (e) {
      const error = ConnectError.from(e);
      if (classifyRefreshError(error) === "signedOut") {
        deps.tokens.clear();
        for (const listener of listeners) {
          listener(error);
        }
        return { kind: "signedOut", error };
      }
      return { kind: "failed", error };
    }
  }

  return {
    refresh() {
      if (inflight === undefined) {
        inflight = run().finally(() => {
          inflight = undefined;
        });
      }
      return inflight;
    },
    onSignedOut(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
