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

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/event_pb";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import {
  cacheBuster,
  createAppPersister,
  deserializePersistedClient,
  PERSIST_KEY,
  serializePersistedClient,
} from "@/api/persist";
import { createMemoryAsyncStorage } from "@/test/storage";

// The protobuf-safe persister (plan 09l F11).

function persisted(data: unknown): PersistedClient {
  return {
    timestamp: 1_700_000_000_000,
    buster: cacheBuster("0.1.0"),
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ["connect-query", { methodName: "ListEvents" }],
          queryHash: '["connect-query",{"methodName":"ListEvents"}]',
          state: {
            data,
            dataUpdateCount: 1,
            dataUpdatedAt: 1_700_000_000_000,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: "success",
            fetchStatus: "idle",
          },
        },
      ],
    },
  };
}

describe("the persisted query cache", () => {
  it("round-trips a message with a Timestamp (bigint seconds) and bytes", () => {
    const created = timestampFromDate(new Date("2026-07-10T12:34:56.789Z"));
    const data = {
      event: create(EventSchema, { id: 7, name: "2026" }),
      created,
      big: 9_007_199_254_740_993n,
      bytes: new Uint8Array([0, 1, 2, 253, 254, 255]),
      nested: { list: [1n, 2n], text: "plain" },
    };
    const input = persisted(data);

    // Why the serializer exists: the default one cannot do this.
    expect(() => JSON.stringify(input)).toThrow(/BigInt/);

    const text = serializePersistedClient(input);
    const output = deserializePersistedClient(text);

    expect(output).toEqual(input);
    const restored = output.clientState.queries[0]?.state.data as typeof data;
    expect(typeof restored.created.seconds).toBe("bigint");
    expect(restored.bytes).toBeInstanceOf(Uint8Array);
    expect(restored.big).toBe(9_007_199_254_740_993n);
  });

  it("does not mistake ordinary objects for tagged values", () => {
    const data = {
      $bigint: 1,
      $bytes: ["not", "a", "string"],
      both: { $bigint: "1", extra: true },
    };
    const output = deserializePersistedClient(
      serializePersistedClient(persisted(data)),
    );
    expect(output.clientState.queries[0]?.state.data).toEqual(data);
  });

  it("writes to and restores from the storage under the app key", async () => {
    const storage = createMemoryAsyncStorage();
    const persister = createAppPersister(storage);
    const input = persisted({ when: timestampFromDate(new Date(0)) });

    await persister.persistClient(input);
    expect(storage.items.has(PERSIST_KEY)).toBe(true);
    await expect(persister.restoreClient()).resolves.toEqual(input);

    await persister.removeClient();
    expect(storage.items.has(PERSIST_KEY)).toBe(false);
    await expect(persister.restoreClient()).resolves.toBeUndefined();
  });

  it("derives the buster from the app version", () => {
    expect(cacheBuster("0.1.0")).toBe("s1-0.1.0");
    expect(cacheBuster(undefined)).toBe("s1-dev");
  });
});
