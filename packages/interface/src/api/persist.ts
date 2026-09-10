// SPDX-License-Identifier: Apache-2.0

import { base64Decode, base64Encode } from "@bufbuild/protobuf/wire";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

// The persisted read cache (plan 09i E5, 09l F11): the query cache is written
// to AsyncStorage so a cold start renders the last known lists at once. Only
// successful queries are dehydrated (TanStack's default), the session's
// GetAuthStatus is not a query, and sign-out removes the whole client.
//
// protobuf-es v2 messages are plain objects, but two of their value types do
// not survive JSON.stringify: bigint (every int64 — Timestamp.seconds in
// particular, so every `created` / `last_modified`) throws, and Uint8Array
// (bytes) is written as an object of indexes. The serializer tags both and the
// deserializer reverses it, so a restored message is structurally the one the
// server sent.

export const PERSIST_KEY = "ocf-ims.query-cache";
/** Older than this is not restored (must be ≤ the query client's gcTime). */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Bump when the persisted shape changes in a way a restored entry would mis-render. */
const PERSIST_SHAPE = "1";

/** A restored cache is discarded when its buster differs, so a new release never hydrates an older shape. */
export function cacheBuster(appVersion: string | undefined): string {
  return `s${PERSIST_SHAPE}-${appVersion ?? "dev"}`;
}

const BIGINT_TAG = "$bigint";
const BYTES_TAG = "$bytes";

export function serializePersistedClient(client: PersistedClient): string {
  return JSON.stringify(client, (_key, value: unknown) => {
    if (typeof value === "bigint") {
      return { [BIGINT_TAG]: value.toString() };
    }
    if (value instanceof Uint8Array) {
      return { [BYTES_TAG]: base64Encode(value) };
    }
    return value;
  });
}

export function deserializePersistedClient(raw: string): PersistedClient {
  return JSON.parse(raw, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      if (keys.length === 1) {
        const tagged = value as Record<string, unknown>;
        if (keys[0] === BIGINT_TAG && typeof tagged[BIGINT_TAG] === "string") {
          return BigInt(tagged[BIGINT_TAG]);
        }
        if (keys[0] === BYTES_TAG && typeof tagged[BYTES_TAG] === "string") {
          return base64Decode(tagged[BYTES_TAG]);
        }
      }
    }
    return value;
  }) as PersistedClient;
}

/** What the persister needs from a storage: the shape of @react-native-async-storage/async-storage and of the in-memory test storage. */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<void>;
}

export function createAppPersister(
  storage: AsyncStorageLike,
  key: string = PERSIST_KEY,
): Persister {
  return createAsyncStoragePersister({
    storage,
    key,
    serialize: serializePersistedClient,
    deserialize: deserializePersistedClient,
  });
}
