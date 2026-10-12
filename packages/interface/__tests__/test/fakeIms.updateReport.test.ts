// SPDX-License-Identifier: Apache-2.0

import { Code } from "@connectrpc/connect";
import { createFakeIms, type FakeIms, type FakeUser } from "@/test/fakeIms";
import {
  makeIncident,
  makeIncidentView,
  makeJournalEntry,
  makeReport,
  makeReportView,
} from "@/test/fixtures";
import { createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The fake's report writes (plan 09z criterion 2): UpdateReport's presence
// semantics, the system entry on a changed link only, and the strike gate.
// Through the promise client, no React.

function fixtureFake(overrides: Partial<FakeUser> = {}): FakeIms {
  const fake = createFakeIms({ user: { writeReports: true, ...overrides } });
  fake.events = [{ id: 1, name: "2026" }];
  fake.incidents = [
    makeIncidentView({ incident: makeIncident({ eventId: 1, number: 12 }) }),
    makeIncidentView({ incident: makeIncident({ eventId: 1, number: 13 }) }),
  ];
  fake.reports = [
    makeReportView({
      report: makeReport({
        number: 5,
        summary: "Original",
        createdBy: { personId: 42, handle: "Dee" },
        incident: 12,
        journalEntries: [
          makeJournalEntry({ id: 50, author: "Dee", text: "Mine" }),
          makeJournalEntry({ id: 51, author: "Ray", text: "Theirs" }),
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

const report = (fake: FakeIms) => fake.reports[0]?.report;

describe("fakeIms — UpdateReport presence semantics", () => {
  it("edits the summary alone, leaving the link and the entries", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);
    await client.updateReport({
      eventId: 1,
      reportNumber: 5,
      report: { summary: "Edited" },
    });
    expect(report(fake)?.summary).toBe("Edited");
    expect(report(fake)?.incident).toBe(12);
    expect(report(fake)?.journalEntries).toHaveLength(2);
  });

  it("refuses a summary edit from a non-creator non-admin", async () => {
    const fake = fixtureFake({ personId: 99, handle: "Kai" });
    const client = await clientFor(fake);
    await expect(
      client.updateReport({
        eventId: 1,
        reportNumber: 5,
        report: { summary: "Nope" },
      }),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
    expect(report(fake)?.summary).toBe("Original");
  });

  it("lets an admin edit another's summary", async () => {
    const fake = fixtureFake({ personId: 99, handle: "Kai", admin: true });
    const client = await clientFor(fake);
    await client.updateReport({
      eventId: 1,
      reportNumber: 5,
      report: { summary: "Admin edit" },
    });
    expect(report(fake)?.summary).toBe("Admin edit");
  });

  it("appends a system entry on a changed link, and detaches on 0", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);
    await client.updateReport({
      eventId: 1,
      reportNumber: 5,
      report: { incident: 13 },
    });
    expect(report(fake)?.incident).toBe(13);
    const entries = report(fake)?.journalEntries ?? [];
    expect(entries).toHaveLength(3);
    expect(entries[2]?.systemEntry).toBe(true);
    expect(report(fake)?.summary).toBe("Original");

    await client.updateReport({
      eventId: 1,
      reportNumber: 5,
      report: { incident: 0 },
    });
    expect(report(fake)?.incident).toBeUndefined();
    expect(report(fake)?.journalEntries).toHaveLength(4);
  });

  it("writes nothing for a same-value link", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);
    await client.updateReport({
      eventId: 1,
      reportNumber: 5,
      report: { incident: 12 },
    });
    expect(report(fake)?.incident).toBe(12);
    expect(report(fake)?.journalEntries).toHaveLength(2);
  });

  it("answers NotFound for an unknown incident", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);
    await expect(
      client.updateReport({
        eventId: 1,
        reportNumber: 5,
        report: { incident: 999 },
      }),
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it("appends journal entries without touching other fields", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);
    await client.updateReport({
      eventId: 1,
      reportNumber: 5,
      report: { journalEntries: [{ text: "Added" }] },
    });
    const entries = report(fake)?.journalEntries ?? [];
    expect(entries).toHaveLength(3);
    expect(entries[2]?.text).toBe("Added");
    expect(report(fake)?.incident).toBe(12);
  });

  it("fails per shape when the behaviour says so", async () => {
    const fake = fixtureFake();
    fake.behaviour.updateReport = { summary: "unavailable" };
    const client = await clientFor(fake);
    await expect(
      client.updateReport({
        eventId: 1,
        reportNumber: 5,
        report: { summary: "x" },
      }),
    ).rejects.toMatchObject({ code: Code.Unavailable });
    await client.updateReport({
      eventId: 1,
      reportNumber: 5,
      report: { incident: 13 },
    });
    expect(report(fake)?.incident).toBe(13);
  });
});

describe("fakeIms — UpdateReportJournalEntry", () => {
  it("lets a reporter strike their own entry, touching only stricken", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);
    await client.updateReportJournalEntry({
      eventId: 1,
      reportNumber: 5,
      journalEntryId: 50,
      entry: { id: 50, stricken: true },
    });
    const entry = report(fake)?.journalEntries.find((e) => e.id === 50);
    expect(entry?.stricken).toBe(true);
    expect(entry?.text).toBe("Mine");
  });

  it("refuses a reporter striking another's entry", async () => {
    const fake = fixtureFake();
    const client = await clientFor(fake);
    await expect(
      client.updateReportJournalEntry({
        eventId: 1,
        reportNumber: 5,
        journalEntryId: 51,
        entry: { id: 51, stricken: true },
      }),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it("lets a writer strike any entry", async () => {
    const fake = fixtureFake({ writeIncidents: true });
    const client = await clientFor(fake);
    await client.updateReportJournalEntry({
      eventId: 1,
      reportNumber: 5,
      journalEntryId: 51,
      entry: { id: 51, stricken: true },
    });
    expect(
      report(fake)?.journalEntries.find((e) => e.id === 51)?.stricken,
    ).toBe(true);
  });
});
