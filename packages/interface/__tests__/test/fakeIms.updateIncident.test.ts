// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  ParticipationType,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { createFakeIms, type FakeIms, type FakeUser } from "@/test/fakeIms";
import {
  makeIncident,
  makeIncidentView,
  makeJournalEntry,
  makeOutcome,
} from "@/test/fixtures";
import { createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The fake's editor RPCs (plan 09y criterion 5): UpdateIncident's presence
// semantics off the wire table, the two person RPCs, the journal-entry
// strike, and outcomes. Exercised directly through the promise client
// (`src/api/client.ts`: "it is for the session layer ... and for tests"),
// no React involved.

let now = 1_700_000_000_000;

function fixtureFake(overrides: Partial<FakeUser> = {}): FakeIms {
  const fake = createFakeIms({
    user: { writeIncidents: true, ...overrides },
    clock: () => now,
  });
  fake.events = [{ id: 1, name: "2026" }];
  fake.people = [
    create(PersonSchema, {
      personId: 7,
      handle: "Ray",
      participationType: ParticipationType.WRITER,
    }),
    create(PersonSchema, { personId: 11, handle: "Priya" }),
  ];
  fake.incidents = [
    makeIncidentView({
      viewerMayAddJournal: true,
      incident: makeIncident({
        eventId: 1,
        number: 12,
        state: IncidentState.OPEN,
        priority: IncidentPriority.NORMAL,
        summary: "Lost child",
        location: { areaSlug: "main-stage", booth: "100" },
        incidentTypeIds: [1, 2],
        reports: [9],
        linkedIncidents: [{ eventId: 1, eventName: "2026", incidentNumber: 3 }],
        journalEntries: [
          makeJournalEntry({ id: 500, author: "Dee", text: "First" }),
        ],
      }),
    }),
  ];
  return fake;
}

async function clientFor(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime.client;
}

describe("fakeIms — UpdateIncident presence semantics", () => {
  it("state/priority UNSPECIFIED leave them; closed stamps on Closed, clears on Open", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);

    now += 1000;
    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: { priority: IncidentPriority.HIGH },
    });
    let incident = fake.incidents[0]?.incident;
    expect(incident?.state).toBe(IncidentState.OPEN);
    expect(incident?.priority).toBe(IncidentPriority.HIGH);
    expect(incident?.closed).toBeUndefined();

    now += 1000;
    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: { state: IncidentState.CLOSED },
    });
    incident = fake.incidents[0]?.incident;
    expect(incident?.state).toBe(IncidentState.CLOSED);
    expect(incident?.closed).toBeDefined();

    now += 1000;
    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: { state: IncidentState.OPEN },
    });
    incident = fake.incidents[0]?.incident;
    expect(incident?.state).toBe(IncidentState.OPEN);
    expect(incident?.closed).toBeUndefined();
  });

  it("summary: present sets, empty clears; outcomeId: 0 clears, positive sets", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);

    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: { outcomeId: 3 },
    });
    expect(fake.incidents[0]?.incident?.outcomeId).toBe(3);

    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: { summary: "" },
    });
    expect(fake.incidents[0]?.incident?.summary).toBeUndefined();

    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: { outcomeId: 0 },
    });
    expect(fake.incidents[0]?.incident?.outcomeId).toBeUndefined();
  });

  it("a present location updates only its set pieces", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);

    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: { location: { booth: "410" } },
    });
    const location = fake.incidents[0]?.incident?.location;
    expect(location?.booth).toBe("410");
    expect(location?.areaSlug).toBe("main-stage");
  });

  it("Int32List / IncidentRefList: present-but-empty clears, absent leaves", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);

    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: { summary: "still set" },
    });
    expect(fake.incidents[0]?.incident?.incidentTypeIds).toEqual([1, 2]);
    expect(fake.incidents[0]?.incident?.reports).toEqual([9]);
    expect(fake.incidents[0]?.incident?.linkedIncidents).toHaveLength(1);

    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: {
        incidentTypeIds: { values: [] },
        reports: { values: [] },
        linkedIncidents: { refs: [] },
      },
    });
    expect(fake.incidents[0]?.incident?.incidentTypeIds).toEqual([]);
    expect(fake.incidents[0]?.incident?.reports).toEqual([]);
    expect(fake.incidents[0]?.incident?.linkedIncidents).toEqual([]);
  });

  it("bumps lastModified and still appends journal entries carried on the same write", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);
    const before = fake.incidents[0]?.incident?.lastModified;

    now += 5000;
    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: {
        summary: "Changed",
        journalEntries: [{ text: "Noted" }],
      },
    });
    const incident = fake.incidents[0]?.incident;
    expect(incident?.lastModified).not.toEqual(before);
    expect(incident?.journalEntries.some((e) => e.text === "Noted")).toBe(true);
  });

  it("the 52f rule: a grantee's non-journal update is a permission error, journal-only succeeds", async () => {
    const fake = fixtureFake({ writeIncidents: false });
    const client = await clientFor(fake);

    await expect(
      client.updateIncident({
        eventId: 1,
        incidentNumber: 12,
        update: { summary: "Sneaky" },
      }),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });

    await client.updateIncident({
      eventId: 1,
      incidentNumber: 12,
      update: { journalEntries: [{ text: "A note" }] },
    });
    expect(
      fake.incidents[0]?.incident?.journalEntries.some(
        (e) => e.text === "A note",
      ),
    ).toBe(true);
  });
});

describe("fakeIms — AttachPersonToIncident / DetachPersonFromIncident", () => {
  it("attaches with hasEventAccess from the person's participation, and re-attach updates the row", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);

    await client.attachPersonToIncident({
      eventId: 1,
      incidentNumber: 12,
      personId: 7,
      involvement: "Witness",
      grantedAccess: false,
    });
    expect(fake.attachRequests).toHaveLength(1);
    let row = fake.incidents[0]?.incident?.people.find(
      (p) => p.person?.personId === 7,
    );
    expect(row?.involvement).toBe("Witness");
    expect(row?.hasEventAccess).toBe(true);

    await client.attachPersonToIncident({
      eventId: 1,
      incidentNumber: 12,
      personId: 11,
      grantedAccess: true,
    });
    row = fake.incidents[0]?.incident?.people.find(
      (p) => p.person?.personId === 11,
    );
    expect(row?.hasEventAccess).toBe(false);

    // Re-attach #7 with a new involvement: updates the existing row, not a duplicate.
    await client.attachPersonToIncident({
      eventId: 1,
      incidentNumber: 12,
      personId: 7,
      involvement: "First Responder",
      grantedAccess: false,
    });
    const rows = fake.incidents[0]?.incident?.people.filter(
      (p) => p.person?.personId === 7,
    );
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.involvement).toBe("First Responder");
    expect(fake.attachRequests).toHaveLength(3);
  });

  it("detaches, and records the request", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);
    await client.attachPersonToIncident({
      eventId: 1,
      incidentNumber: 12,
      personId: 7,
      grantedAccess: false,
    });

    await client.detachPersonFromIncident({
      eventId: 1,
      incidentNumber: 12,
      personId: 7,
    });

    expect(fake.detachRequests).toHaveLength(1);
    expect(
      fake.incidents[0]?.incident?.people.some((p) => p.person?.personId === 7),
    ).toBe(false);
  });

  it("requires the write bit — a grantee may not attach or detach", async () => {
    const fake = fixtureFake({ writeIncidents: false });
    const client = await clientFor(fake);

    await expect(
      client.attachPersonToIncident({
        eventId: 1,
        incidentNumber: 12,
        personId: 7,
        grantedAccess: false,
      }),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });
});

describe("fakeIms — UpdateIncidentJournalEntry", () => {
  it("touches only stricken", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);

    await client.updateIncidentJournalEntry({
      eventId: 1,
      incidentNumber: 12,
      journalEntryId: 500,
      entry: { id: 500, stricken: true },
    });

    expect(fake.entryUpdateRequests).toHaveLength(1);
    const entry = fake.incidents[0]?.incident?.journalEntries.find(
      (e) => e.id === 500,
    );
    expect(entry?.stricken).toBe(true);
    expect(entry?.text).toBe("First");
    expect(entry?.author).toBe("Dee");
  });
});

describe("fakeIms — ListOutcomes / ProposeOutcome", () => {
  it("lists the seeded outcomes", async () => {
    const fake = fixtureFake();
    fake.outcomes = [makeOutcome({ id: 1, name: "Resolved on scene" })];
    const client = await clientFor(fake);

    const res = await client.listOutcomes({});
    expect(res.outcomes.map((o) => o.name)).toEqual(["Resolved on scene"]);
  });

  it("a name collision resolves to the existing outcome's id", async () => {
    const fake = fixtureFake();
    fake.outcomes = [makeOutcome({ id: 1, name: "Resolved on scene" })];
    const client = await clientFor(fake);

    const res = await client.proposeOutcome({
      eventId: 1,
      outcome: { name: "resolved on scene" },
    });
    expect(res.outcomeId).toBe(1);
    expect(fake.outcomes).toHaveLength(1);
  });

  it("proposes a new outcome otherwise", async () => {
    const fake = fixtureFake();
    fake.outcomes = [makeOutcome({ id: 1, name: "Resolved on scene" })];
    const client = await clientFor(fake);

    const res = await client.proposeOutcome({
      eventId: 1,
      outcome: { name: "Referred to White Bird" },
    });
    expect(res.outcomeId).toBe(2);
    expect(fake.outcomes.map((o) => o.name)).toContain(
      "Referred to White Bird",
    );
  });
});
