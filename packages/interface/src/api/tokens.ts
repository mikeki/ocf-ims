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

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";

// The access token's only home (plan 09l F2): a synchronous in-memory cache the
// auth interceptor reads on every call. It is never persisted — a cold start
// re-mints it from the refresh token (SecureStore on native, the HttpOnly cookie
// on web), which is the whole point of the split.

export interface AccessToken {
  readonly token: string;
  /**
   * When to consider the token expired, epoch milliseconds. The server's
   * `expires_at` is already 10 s before the real expiry
   * (authz.SuggestedEarlyAccessTokenRefresh).
   */
  readonly expiresAt: number;
}

export interface AccessTokenCache {
  get(): AccessToken | undefined;
  set(token: AccessToken): void;
  clear(): void;
  /**
   * True when a token is cached and expires within `ms` of now. False with no
   * token: there is nothing to refresh proactively; the reactive path (an
   * Unauthenticated answer) covers a signed-out caller.
   */
  expiringWithin(ms: number): boolean;
}

export function createAccessTokenCache(
  clock: () => number = Date.now,
): AccessTokenCache {
  let current: AccessToken | undefined;
  return {
    get: () => current,
    set: (token) => {
      current = token;
    },
    clear: () => {
      current = undefined;
    },
    expiringWithin: (ms) =>
      current !== undefined && current.expiresAt - clock() <= ms,
  };
}

/**
 * Builds the cache entry from a Login / RefreshToken response. A response
 * without `expires_at` (the server always sets it) never triggers a proactive
 * refresh — the reactive path is the correctness path, proactive is only the
 * optimisation.
 */
export function accessTokenFrom(resp: {
  token: string;
  expiresAt?: Timestamp;
}): AccessToken {
  return {
    token: resp.token,
    expiresAt: resp.expiresAt
      ? timestampDate(resp.expiresAt).getTime()
      : Number.POSITIVE_INFINITY,
  };
}
