// SPDX-License-Identifier: Apache-2.0

import { create, toJson } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { createConnectQueryKey } from "@connectrpc/connect-query";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { PersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type {
  GetIncidentResponse,
  IncidentUpdate,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { IncidentUpdateSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ApiProvider } from "@/api/providers";
import { ThemeProvider } from "@/design/theme";
import { useIncident } from "@/features/incidents/hooks";
import { useEditIncident } from "@/features/incidents/useEditIncident";
import { SessionProvider } from "@/session/provider";
import { createRuntime, type Runtime } from "@/session/runtime";
import { createFakeBlobs } from "@/test/fakeBlobs";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import {
  makeIncident,
  makeIncidentView,
  makeJournalEntry,
} from "@/test/fixtures";
import { createTestQueryClient } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// useEditIncident (plan 09y criteria 1 and 6): every setter sends only its
// own field, the optimistic patch lands ahead of the network, a failing save
// restores only its field, and every settle invalidates the incident and the
// list. The fake carries no artificial delay (criterion 5), so two of these
// tests wrap the transport with their own timing — a held gate for "before
// the fake answers", a content-matched rejection for the failing save — the
// hook doesn't otherwise need controllable timing to prove its contract.

function editorFake(): FakeIms {
  const fake = createFakeIms({ user: { writeIncidents: true } });
  fake.events = [{ id: 1, name: "2026" }];
  fake.people = [
    create(PersonSchema, { personId: 7, handle: "Ray", name: "Ray Okafor" }),
  ];
  fake.incidents = [
    makeIncidentView({
      viewerMayAddJournal: true,
      incident: makeIncident({
        eventId: 1,
        number: 12,
        summary: "Lost child",
        location: { booth: "100", description: "Near stage" },
        journalEntries: [
          makeJournalEntry({ id: 500, author: "Dee", text: "First" }),
        ],
      }),
    }),
  ];
  return fake;
}

async function runtimeOver(
  fake: FakeIms,
  wrap: (base: Transport) => Transport = (t) => t,
): Promise<Runtime> {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createRuntime({
    makeTransport: (interceptors) =>
      wrap(createRouterTransport(fake.routes, { transport: { interceptors } })),
    store,
    platform: "native",
    makeBlobs: () => createFakeBlobs(),
  });
  await runtime.session.bootstrap();
  return runtime;
}

/** Holds every call to `methodName` open until `gate` resolves. */
function delayMethod(
  base: Transport,
  methodName: string,
  gate: Promise<void>,
): Transport {
  return {
    ...base,
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      if (method.name === methodName) {
        await gate;
      }
      return base.unary(
        method,
        signal,
        timeoutMs,
        header,
        input,
        contextValues,
      );
    },
  };
}

/** Rejects every call to `methodName` whose input matches, before it reaches the fake. */
function failMethod(
  base: Transport,
  methodName: string,
  matches: (input: { update?: IncidentUpdate }) => boolean,
): Transport {
  return {
    ...base,
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      if (
        method.name === methodName &&
        matches(input as { update?: IncidentUpdate })
      ) {
        throw new ConnectError("redeploying", Code.Unavailable);
      }
      return base.unary(
        method,
        signal,
        timeoutMs,
        header,
        input,
        contextValues,
      );
    },
  };
}

function wrapperFor(
  runtime: Runtime,
  queryClient: ReturnType<typeof createTestQueryClient>,
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider scheme="light">
        <ApiProvider transport={runtime.transport} queryClient={queryClient}>
          <SessionProvider session={runtime.session}>
            {children}
          </SessionProvider>
        </ApiProvider>
      </ThemeProvider>
    );
  };
}

function useProbe(eventId: number, number: number) {
  const incidentQuery = useIncident(eventId, number);
  const edit = useEditIncident(eventId, number);
  return { incidentQuery, edit };
}

function keysOf(update: IncidentUpdate | undefined): string[] {
  return update ? Object.keys(toJson(IncidentUpdateSchema, update)).sort() : [];
}

async function mountProbe(
  runtime: Runtime,
  queryClient: ReturnType<typeof createTestQueryClient>,
) {
  const { result } = await renderHook(() => useProbe(1, 12), {
    wrapper: wrapperFor(runtime, queryClient),
  });
  await waitFor(() => expect(result.current.incidentQuery.data).toBeDefined());
  return result;
}

describe("useEditIncident", () => {
  it("a summary save sends only { summary, journalEntries: [] }", async () => {
    const fake = editorFake();
    const runtime = await runtimeOver(fake);
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);

    await act(async () => {
      await result.current.edit.setSummary("New summary");
    });

    expect(fake.updateRequests).toHaveLength(1);
    const update = fake.updateRequests[0]?.update;
    expect(update?.summary).toBe("New summary");
    expect(update?.journalEntries).toEqual([]);
    expect(keysOf(update)).toEqual(["summary"]);
  });

  it("the cache shows the optimistic value before the fake answers", async () => {
    const fake = editorFake();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = await runtimeOver(fake, (t) =>
      delayMethod(t, "UpdateIncident", gate),
    );
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);

    const key = createConnectQueryKey({
      schema: ImsService.method.getIncident,
      transport: runtime.transport,
      input: { eventId: 1, incidentNumber: 12 },
      cardinality: "finite",
    });

    let saved: Promise<void> = Promise.resolve();
    await act(async () => {
      saved = result.current.edit.setSummary("New summary");
      await waitFor(() =>
        expect(
          queryClient.getQueryData<GetIncidentResponse>(key)?.incident?.incident
            ?.summary,
        ).toBe("New summary"),
      );
    });
    // Still held: the fake has not answered yet.
    expect(fake.updateRequests).toHaveLength(0);

    await act(async () => {
      release();
      await saved;
    });
    expect(fake.updateRequests).toHaveLength(1);
  });

  it("a failing save restores only that field; another field's optimistic value survives", async () => {
    const fake = editorFake();
    const runtime = await runtimeOver(fake, (t) =>
      failMethod(
        t,
        "UpdateIncident",
        (input) => input.update?.location?.description !== undefined,
      ),
    );
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);

    let boothSave: Promise<void> = Promise.resolve();
    await act(async () => {
      boothSave = result.current.edit.setBooth("410");
      await expect(
        result.current.edit.setDescription("New details"),
      ).rejects.toThrow();
    });
    await act(async () => {
      await boothSave;
    });

    await waitFor(() =>
      expect(result.current.edit.status("description").error).toBeDefined(),
    );
    expect(result.current.edit.status("booth").error).toBeUndefined();
    const incident = result.current.incidentQuery.data?.incident?.incident;
    expect(incident?.location?.booth).toBe("410");
    expect(incident?.location?.description).toBe("Near stage");
  });

  it("a booth save sends only { location: { booth } }", async () => {
    const fake = editorFake();
    const runtime = await runtimeOver(fake);
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);

    await act(async () => {
      await result.current.edit.setBooth("410");
    });

    const update = fake.updateRequests.at(-1)?.update;
    expect(update?.location?.booth).toBe("410");
    expect(update?.location?.areaSlug).toBeUndefined();
    expect(update?.location?.description).toBeUndefined();
    expect(keysOf(update)).toEqual(["location"]);
  });

  it("attachPerson and detachPerson hit the two RPCs", async () => {
    const fake = editorFake();
    const runtime = await runtimeOver(fake);
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);
    const person = create(PersonSchema, { personId: 7, handle: "Ray" });

    await act(async () => {
      await result.current.edit.attachPerson(person, "Witness", false);
    });
    expect(fake.attachRequests).toHaveLength(1);
    expect(fake.attachRequests[0]).toMatchObject({
      eventId: 1,
      incidentNumber: 12,
      personId: 7,
      involvement: "Witness",
      grantedAccess: false,
    });

    await act(async () => {
      await result.current.edit.detachPerson(7);
    });
    expect(fake.detachRequests).toHaveLength(1);
    expect(fake.detachRequests[0]).toMatchObject({
      eventId: 1,
      incidentNumber: 12,
      personId: 7,
    });
  });

  it("setStricken sends only stricken", async () => {
    const fake = editorFake();
    const runtime = await runtimeOver(fake);
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);

    await act(async () => {
      await result.current.edit.setStricken(500, true);
    });

    expect(fake.entryUpdateRequests).toHaveLength(1);
    const req = fake.entryUpdateRequests[0];
    expect(req?.journalEntryId).toBe(500);
    expect(req?.entry?.id).toBe(500);
    expect(req?.entry?.stricken).toBe(true);
    expect(
      req?.entry
        ? Object.keys(toJson(JournalEntrySchema, req.entry)).sort()
        : [],
    ).toEqual(["id", "stricken"]);
  });

  it("every settle invalidates the incident and the list", async () => {
    const fake = editorFake();
    const runtime = await runtimeOver(fake);
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    invalidateSpy.mockClear();

    await act(async () => {
      await result.current.edit.setSummary("Changed");
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});
