// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { BoardScreen } from "@/features/board/BoardScreen";
import { seenKey } from "@/features/board/seen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import {
  makeIncident,
  makeIncidentView,
  makeReport,
  makeReportView,
} from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The Board against the real runtime (plan 09q, slice 3b.1), following
// IncidentScreen.test.tsx: sign in with a stored refresh token so the screen
// mounts already authenticated, and bootstrap BEFORE mounting — useEventAccess
// reads GetAuthStatus, which answers 200 `authenticated: false` for an
// anonymous caller rather than throwing, so a call fired before bootstrap
// finishes would cache "no access" for its 5-minute staleTime.

const ME = 42; // the fake user's personId
const OTHER = 3;

const me = create(PersonRefSchema, { personId: ME, handle: "Dee" });
const other = create(PersonRefSchema, { personId: OTHER, handle: "Marisol" });

function at(iso: string) {
  return timestampFromDate(new Date(iso));
}

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

/**
 * One event holding: an incident of mine by attachment, one of mine by
 * creation, one that mentions me, one that is nobody's business of mine, and
 * a report that mentions me.
 */
function populate(fake: FakeIms) {
  fake.events = [{ id: 1, name: "2026" }];
  fake.incidents = [
    makeIncidentView({
      incident: makeIncident({
        eventId: 1,
        number: 214,
        summary: "Lost child reunited with parent",
        lastModified: at("2026-08-15T18:42:00Z"),
        createdBy: other,
        people: [{ person: me, hasEventAccess: true }],
      }),
    }),
    makeIncidentView({
      incident: makeIncident({
        eventId: 1,
        number: 209,
        summary: "Dehydration on the loading crew",
        lastModified: at("2026-08-15T17:55:00Z"),
        createdBy: me,
      }),
    }),
    makeIncidentView({
      incident: makeIncident({
        eventId: 1,
        number: 198,
        summary: "Generator fumes near the seating",
        lastModified: at("2026-08-15T16:20:00Z"),
        createdBy: other,
        journalEntries: [
          create(JournalEntrySchema, {
            id: 1,
            created: at("2026-08-15T16:20:00Z"),
            author: "Marisol",
            text: "@Dee did the vendor move it?",
            mentions: [me],
          }),
        ],
      }),
    }),
    makeIncidentView({
      incident: makeIncident({
        eventId: 1,
        number: 221,
        summary: "Noise complaint, north camping",
        lastModified: at("2026-08-15T19:02:00Z"),
        createdBy: other,
      }),
    }),
  ];
  fake.reports = [
    makeReportView({
      report: makeReport({
        number: 38,
        summary: "Camp Chaos sound after quiet hours",
        created: at("2026-08-15T02:10:00Z"),
        createdBy: other,
        journalEntries: [
          create(JournalEntrySchema, {
            id: 2,
            created: at("2026-08-15T18:05:00Z"),
            author: "Trung",
            text: "@Dee can you take the follow-up?",
            mentions: [me],
          }),
        ],
      }),
    }),
  ];
}

function renderBoard(runtime: ReturnType<typeof createTestRuntime>) {
  return renderWithProviders(
    <BoardScreen
      eventId={1}
      onBack={() => {}}
      onOpenIncident={() => {}}
      onOpenReport={() => {}}
    />,
    runtime,
  );
}

describe("BoardScreen", () => {
  it("opens on Mine, holding only the incidents that are the viewer's", async () => {
    const fake = createFakeIms();
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderBoard(runtime);

    await waitFor(() => {
      expect(screen.getByTestId("incident-row-214")).toBeTruthy();
    });
    expect(screen.getByTestId("incident-row-209")).toBeTruthy();
    expect(screen.getByTestId("incident-row-198")).toBeTruthy();
    // Not mine by any rule, and the newest in the event — so its absence is
    // the filter working rather than the ordering hiding it.
    expect(screen.queryByTestId("incident-row-221")).toBeNull();
  });

  it("shows the whole event under All, and marks which rows are the viewer's", async () => {
    const fake = createFakeIms();
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderBoard(runtime);
    await waitFor(() => {
      expect(screen.getByTestId("incident-row-214")).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId("board-segment-all"));

    await waitFor(() => {
      expect(screen.getByTestId("incident-row-221")).toBeTruthy();
    });
    expect(screen.getAllByLabelText("Yours")).toHaveLength(3);
  });

  it("counts unread on the segment that lists them, not across the board", async () => {
    const fake = createFakeIms();
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderBoard(runtime);

    // Mine: #214 (attached) and #198 (mentioned) are unread on first sight;
    // #209 is mine by creation, so it is not. The report is the Reports
    // segment's business and must not be counted here.
    await waitFor(() => {
      expect(screen.getByLabelText("Mine, 2 unread")).toBeTruthy();
    });
    expect(screen.getByLabelText("Reports, 1 unread")).toBeTruthy();
  });

  it("clears a row's unread mark when it is opened, and remembers it", async () => {
    const fake = createFakeIms();
    populate(fake);
    const runtime = await signedInRuntime(fake);
    const opened: number[] = [];
    await renderWithProviders(
      <BoardScreen
        eventId={1}
        onBack={() => {}}
        onOpenIncident={(n) => opened.push(n)}
        onOpenReport={() => {}}
      />,
      runtime,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Mine, 2 unread")).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId("incident-row-214"));
    expect(opened).toEqual([214]);

    await waitFor(() => {
      expect(screen.getByLabelText("Mine, 1 unread")).toBeTruthy();
    });
    // …and it is on the device, not just in this render.
    const AsyncStorage = jest.requireMock(
      "@react-native-async-storage/async-storage",
    );
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(seenKey(1));
      expect(raw).toContain("i214");
    });
  });

  it("hides the Reports segment when the caller may not read reports", async () => {
    const fake = createFakeIms();
    populate(fake);
    fake.behaviour.listReports = "forbidden";
    const runtime = await signedInRuntime(fake);
    await renderBoard(runtime);

    await waitFor(() => {
      expect(screen.getByTestId("incident-row-214")).toBeTruthy();
    });
    // There is no read-reports flag on AccessForEvent to ask beforehand, so
    // the segment can only go away once the call has answered (09q).
    await waitFor(() => {
      expect(screen.queryByTestId("board-segment-reports")).toBeNull();
    });
    expect(screen.getByTestId("board-segment-mine")).toBeTruthy();
  });

  it("says so, kindly, when nothing is the viewer's yet", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({ eventId: 1, number: 221, createdBy: other }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    await renderBoard(runtime);

    await waitFor(() => {
      expect(screen.getByText("Nothing is yours yet")).toBeTruthy();
    });
  });
});
