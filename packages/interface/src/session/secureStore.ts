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

import type { RefreshTokenStore } from "@/session/types";

// The native refresh-token store's platform-neutral core (plan 09l F9), so it
// is testable with a fake SecureStore. store.native.ts binds it to
// expo-secure-store. Only the refresh token is stored — never the access
// token, never the credentials.

export const REFRESH_TOKEN_KEY = "ocf-ims.refresh-token";

/**
 * expo-secure-store's value limit: iOS keychain and Android keystore-backed
 * storage stop being reliable above 2 KB. The HS256 refresh JWT the server
 * mints is a few hundred bytes; a test pins that.
 */
export const MAX_REFRESH_TOKEN_BYTES = 2048;

/** The subset of expo-secure-store the store needs. */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** UTF-8 byte length without TextEncoder (not guaranteed on every RN runtime). */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) {
      bytes += 1;
    } else if (cp < 0x800) {
      bytes += 2;
    } else if (cp < 0x10000) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

export function createSecureRefreshTokenStore(
  secureStore: SecureStoreLike,
  key: string = REFRESH_TOKEN_KEY,
): RefreshTokenStore {
  return {
    async load() {
      const value = await secureStore.getItemAsync(key);
      return value === null || value === "" ? undefined : value;
    },
    async save(token) {
      if (token === "") {
        throw new Error("refusing to store an empty refresh token");
      }
      const size = utf8ByteLength(token);
      if (size > MAX_REFRESH_TOKEN_BYTES) {
        throw new Error(
          `refresh token is ${size} bytes, over the ${MAX_REFRESH_TOKEN_BYTES}-byte secure-store limit`,
        );
      }
      await secureStore.setItemAsync(key, token);
    },
    async clear() {
      await secureStore.deleteItemAsync(key);
    },
  };
}
