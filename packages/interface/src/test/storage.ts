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

import type { AsyncStorageLike } from "@/api/persist";
import type { SecureStoreLike } from "@/session/secureStore";
import type { RefreshTokenStore } from "@/session/types";

// In-memory stand-ins for the platform storages, for Jest.

export interface MemoryRefreshTokenStore extends RefreshTokenStore {
  value: string | undefined;
  saves: number;
  clears: number;
}

export function createMemoryRefreshTokenStore(
  initial?: string,
): MemoryRefreshTokenStore {
  const store: MemoryRefreshTokenStore = {
    value: initial,
    saves: 0,
    clears: 0,
    load: () => Promise.resolve(store.value),
    save: (token) => {
      store.value = token;
      store.saves += 1;
      return Promise.resolve();
    },
    clear: () => {
      store.value = undefined;
      store.clears += 1;
      return Promise.resolve();
    },
  };
  return store;
}

export interface MemorySecureStore extends SecureStoreLike {
  items: Map<string, string>;
}

export function createMemorySecureStore(): MemorySecureStore {
  const items = new Map<string, string>();
  return {
    items,
    getItemAsync: (key) => Promise.resolve(items.get(key) ?? null),
    setItemAsync: (key, value) => {
      items.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key) => {
      items.delete(key);
      return Promise.resolve();
    },
  };
}

export interface MemoryAsyncStorage extends AsyncStorageLike {
  items: Map<string, string>;
}

export function createMemoryAsyncStorage(): MemoryAsyncStorage {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => Promise.resolve(items.get(key) ?? null),
    setItem: (key, value) => {
      items.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      items.delete(key);
      return Promise.resolve();
    },
  };
}
