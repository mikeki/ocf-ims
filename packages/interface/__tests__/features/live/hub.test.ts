// SPDX-License-Identifier: Apache-2.0

import type { DescMethodUnary, MessageInitShape } from "@bufbuild/protobuf";
import { createConnectQueryKey } from "@connectrpc/connect-query";
import type { ListIncidentsResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { createLiveHub } from "@/features/live/hub";
import { createFakeIms } from "@/test/fakeIms";
import {
  makeIncident,
  makeIncidentView,
  makeJournalEntry,
} from "@/test/fixtures";
import { createTestQueryClient, createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The live hub (plan 09v/09x): reference-counted streams, a poke that patches
// the cached lists (criterion 10) rather than refetching them, the
// background pause and the foreground resume with a full refetch.

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
  // The source GetIncident/ListIncidents read from (plan 09x criterion 10:
  // the patch calls the real GetIncident route through the fake).
  fake.incidents = [
    makeIncidentView({
      incident: makeIncident({ eventId: 1, number: 12, summary: "A" }),
    }),
    makeIncidentView({
      incident: makeIncident({ eventId: 1, number: 13, summary: "B" }),
    }),
  ];
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
  queryClient.setQueryData(incident12 as never, {} as never);
  queryClient.setQueryData(incident13 as never, {} as never);
  // The list cache mirrors what `useIncidents` would actually hold — the
  // patch reads and writes `.incidents`, unlike the other seeded reads.
  queryClient.setQueryData(
    list as never,
    {
      incidents: fake.incidents,
    } as never,
  );
  queryClient.setQueryData(report3 as never, {} as never);
  const invalidated = (k: readonly unknown[]) =>
    queryClient.getQueryState(k as never)?.isInvalidated === true;
  const listData = () =>
    queryClient.getQueryData<ListIncidentsResponse>(list as never);
  const hub = createLiveHub({
    client: runtime.client,
    queryClient,
    transport: runtime.transport,
    stream: { sleep: async () => undefined },
  });
  return {
    fake,
    hub,
    invalidated,
    incident12,
    incident13,
    list,
    report3,
    listData,
  };
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

  it("invalidates the record a poke names, nothing else — the list is patched, not refetched", async () => {
    const { fake, hub, invalidated, incident12, incident13, list, report3 } =
      await setup();
    const release = hub.watch(1);
    await until(() => hub.isLive(1));
    fake.poke({ eventId: 1, incidentNumber: 12 });
    await until(() => invalidated(incident12));
    expect(invalidated(list)).toBe(false);
    expect(invalidated(incident13)).toBe(false);
    expect(invalidated(report3)).toBe(false);
    release();
  });

  it("patches the cached list in place: replaces the row a poke names", async () => {
    const { fake, hub, listData } = await setup();
    const release = hub.watch(1);
    await until(() => hub.isLive(1));
    fake.incidents = fake.incidents.map((v) =>
      v.incident?.number === 12
        ? makeIncidentView({
            incident: makeIncident({
              eventId: 1,
              number: 12,
              summary: "Updated by the poke",
            }),
          })
        : v,
    );
    fake.poke({ eventId: 1, incidentNumber: 12 });
    await until(
      () =>
        listData()?.incidents.find((v) => v.incident?.number === 12)?.incident
          ?.summary === "Updated by the poke",
    );
    // #13 is untouched, the row count did not grow, and #12 kept its place.
    expect(listData()?.incidents).toHaveLength(2);
    expect(listData()?.incidents[0]?.incident?.number).toBe(12);
    expect(
      listData()?.incidents.find((v) => v.incident?.number === 13)?.incident
        ?.summary,
    ).toBe("B");
    release();
  });

  it("inserts a row the cached list didn't have yet", async () => {
    const { fake, hub, listData } = await setup();
    const release = hub.watch(1);
    await until(() => hub.isLive(1));
    fake.incidents = [
      ...fake.incidents,
      makeIncidentView({
        incident: makeIncident({ eventId: 1, number: 99, summary: "New" }),
      }),
    ];
    fake.poke({ eventId: 1, incidentNumber: 99 });
    await until(
      () =>
        listData()?.incidents.some((v) => v.incident?.number === 99) === true,
    );
    expect(listData()?.incidents).toHaveLength(3);
    release();
  });

  it("removes a row on NotFound — the incident went private to this viewer", async () => {
    const { fake, hub, listData } = await setup();
    const release = hub.watch(1);
    await until(() => hub.isLive(1));
    fake.incidents = fake.incidents.filter((v) => v.incident?.number !== 13);
    fake.poke({ eventId: 1, incidentNumber: 13 });
    await until(
      () =>
        listData()?.incidents.some((v) => v.incident?.number === 13) === false,
    );
    expect(listData()?.incidents).toHaveLength(1);
    release();
  });

  it("falls back to a list refetch when GetIncident fails for any reason but NotFound", async () => {
    const { fake, hub, invalidated, list, listData } = await setup();
    const release = hub.watch(1);
    await until(() => hub.isLive(1));
    fake.behaviour.getIncident = "unavailable";
    fake.poke({ eventId: 1, incidentNumber: 12 });
    await until(() => invalidated(list));
    // Nothing was written into the cache; the refetch is what corrects it.
    expect(listData()?.incidents).toHaveLength(2);
    release();
  });

  it("strips system journal entries so the cache matches excludeSystemEntries", async () => {
    const { fake, hub, listData } = await setup();
    const release = hub.watch(1);
    await until(() => hub.isLive(1));
    fake.incidents = fake.incidents.map((v) =>
      v.incident?.number === 12
        ? makeIncidentView({
            incident: makeIncident({
              eventId: 1,
              number: 12,
              journalEntries: [
                makeJournalEntry({ id: 1, systemEntry: false, text: "Note" }),
                makeJournalEntry({
                  id: 2,
                  systemEntry: true,
                  text: "Changed priority",
                }),
              ],
            }),
          })
        : v,
    );
    fake.poke({ eventId: 1, incidentNumber: 12 });
    await until(
      () =>
        (listData()?.incidents.find((v) => v.incident?.number === 12)?.incident
          ?.journalEntries.length ?? -1) === 1,
    );
    const entries = listData()?.incidents.find((v) => v.incident?.number === 12)
      ?.incident?.journalEntries;
    expect(entries?.map((e) => e.id)).toEqual([1]);
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
