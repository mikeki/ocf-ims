// SPDX-License-Identifier: Apache-2.0

import type { DescMethodUnary, MessageInitShape } from "@bufbuild/protobuf";
import { createConnectQueryKey } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { createLiveHub } from "@/features/live/hub";
import { createFakeIms } from "@/test/fakeIms";
import { createTestQueryClient, createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The live hub (plan 09v): reference-counted streams, pokes → invalidations,
// the background pause and the foreground resume with a full refetch.

function until(check: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) {
        resolve();
      } else if (Date.now() - start > ms) {
        reject(new Error("timed out"));
      } else {
        setTimeout(tick, 5);
      }
    };
    tick();
  });
}

async function setup() {
  const fake = createFakeIms();
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  const queryClient = createTestQueryClient();
  const key = <M extends DescMethodUnary>(
    schema: M,
    input: MessageInitShape<M["input"]>,
  ) =>
    createConnectQueryKey({
      schema,
      transport: runtime.transport,
      cardinality: "finite",
      input,
    });
  // Seed reads so invalidation has something to mark.
  const incident12 = key(ImsService.method.getIncident, {
    eventId: 1,
    incidentNumber: 12,
  });
  const incident13 = key(ImsService.method.getIncident, {
    eventId: 1,
    incidentNumber: 13,
  });
  const list = key(ImsService.method.listIncidents, {
    eventId: 1,
    excludeSystemEntries: true,
  });
  const report3 = key(ImsService.method.getReport, {
    eventId: 1,
    reportNumber: 3,
  });
  for (const k of [incident12, incident13, list, report3]) {
    queryClient.setQueryData(k as never, {} as never);
  }
  const invalidated = (k: readonly unknown[]) =>
    queryClient.getQueryState(k as never)?.isInvalidated === true;
  const hub = createLiveHub({
    client: runtime.client,
    queryClient,
    transport: runtime.transport,
    stream: { sleep: async () => undefined },
  });
  return { fake, hub, invalidated, incident12, incident13, list, report3 };
}

describe("createLiveHub", () => {
  it("opens one stream per event, shared by every watcher, and closes on the last release", async () => {
    const { fake, hub } = await setup();
    const releaseA = hub.watch(1);
    const releaseB = hub.watch(1);
    await until(() => hub.isLive(1));
    expect(fake.callsOf("WatchEvent")).toHaveLength(1);
    releaseA();
    expect(fake.openStreams).toHaveLength(1);
    releaseB();
    await until(() => fake.openStreams.length === 0);
    expect(hub.isLive(1)).toBe(false);
  });

  it("invalidates the record a poke names and its list, nothing else", async () => {
    const { fake, hub, invalidated, incident12, incident13, list, report3 } =
      await setup();
    const release = hub.watch(1);
    await until(() => hub.isLive(1));
    fake.poke({ eventId: 1, incidentNumber: 12 });
    await until(() => invalidated(incident12));
    expect(invalidated(list)).toBe(true);
    expect(invalidated(incident13)).toBe(false);
    expect(invalidated(report3)).toBe(false);
    release();
  });

  it("pauses in the background and resumes in the foreground with a full refetch", async () => {
    const { fake, hub, invalidated, incident13, report3 } = await setup();
    const release = hub.watch(1);
    await until(() => hub.isLive(1));
    hub.setActive(false);
    await until(() => fake.openStreams.length === 0);
    expect(hub.isLive(1)).toBe(false);
    expect(invalidated(incident13)).toBe(false);
    hub.setActive(true);
    await until(() => hub.isLive(1));
    expect(invalidated(incident13)).toBe(true);
    expect(invalidated(report3)).toBe(true);
    release();
  });

  it("refetches everything after a dropped stream comes back", async () => {
    const { fake, hub, invalidated, incident13 } = await setup();
    const release = hub.watch(1);
    await until(() => hub.isLive(1));
    const seen: boolean[] = [];
    hub.subscribe(() => seen.push(hub.isLive(1)));
    fake.endStreams();
    await until(() => invalidated(incident13));
    expect(seen).toEqual([false, true]);
    expect(fake.callsOf("WatchEvent")).toHaveLength(2);
    release();
  });

  it("does not open while inactive, and opens on activation", async () => {
    const fake = createFakeIms();
    const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
    const runtime = createTestRuntime({ fake, store, platform: "native" });
    await runtime.session.bootstrap();
    const hub = createLiveHub({
      client: runtime.client,
      queryClient: createTestQueryClient(),
      transport: runtime.transport,
      active: false,
    });
    const release = hub.watch(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.callsOf("WatchEvent")).toHaveLength(0);
    hub.setActive(true);
    await until(() => hub.isLive(1));
    release();
  });
});
