// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ReportScreen } from "@/features/board/ReportScreen";
import { resetOnBehalfOf } from "@/features/compose/hooks";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import {
  makeIncident,
  makeIncidentView,
  makeJournalEntry,
  makeReport,
  makeReportView,
} from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The Ledger pane (plan 09z criteria 8, 12, 15), rendered embedded as the
// drawer and the page do, over the real runtime and the fake's report
// semantics from builder 1.

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

const at = (minute: number) =>
  timestampFromDate(new Date(Date.UTC(2026, 6, 4, 12, minute)));

interface Options {
  incident?: number;
  mayEditSummary?: boolean;
  mayAddJournalEntry?: boolean;
  /** Whether incident 214 exists for this viewer; a private one answers 404. */
  readable?: boolean;
  createdBy?: number;
}

function populate(fake: FakeIms, options: Options = {}) {
  const { incident, readable = true, createdBy = 42 } = options;
  fake.events = [{ id: 1, name: "2026" }];
  fake.people = [
    create(PersonSchema, { personId: 11, handle: "Priya", name: "Priya R." }),
  ];
  fake.incidents = readable
    ? [
        makeIncidentView({
          incident: makeIncident({
            eventId: 1,
            number: 214,
            summary: "Lost child",
          }),
        }),
      ]
    : [];
  fake.reports = [
    makeReportView({
      mayEditSummary: options.mayEditSummary ?? false,
      mayAddJournalEntry: options.mayAddJournalEntry ?? false,
      report: makeReport({
        number: 38,
        summary: "What I saw",
        incident,
        createdBy: { personId: createdBy, handle: "Dee" },
        journalEntries: [
          makeJournalEntry({
            id: 1,
            text: "Oldest",
            author: "Dee",
            created: at(1),
          }),
          makeJournalEntry({
            id: 2,
            text: "Newest",
            author: "Priya",
            created: at(5),
          }),
          makeJournalEntry({
            id: 3,
            text: "Linked to incident #214",
            author: "Priya",
            systemEntry: true,
            created: at(3),
          }),
          makeJournalEntry({
            id: 4,
            text: "Struck out",
            author: "Dee",
            stricken: true,
            created: at(2),
          }),
        ],
      }),
    }),
  ];
}

async function typeInto(testID: string, text: string) {
  const input = screen.getByTestId(testID);
  await fireEvent.changeText(input, text);
  await fireEvent(input, "selectionChange", {
    nativeEvent: { selection: { start: text.length, end: text.length } },
  });
}

async function renderPane(
  fake: FakeIms,
  handlers: { onOpenIncident?: (n: number) => void } = {},
) {
  const runtime = await signedInRuntime(fake);
  await renderWithProviders(
    <ReportScreen
      chrome="embedded"
      eventId={1}
      number={38}
      onBack={() => undefined}
      onOpenIncident={handlers.onOpenIncident ?? (() => undefined)}
      onCreateIncident={() => undefined}
    />,
    runtime,
  );
  await screen.findByTestId("ledger-summary-value");
}

afterEach(async () => {
  resetOnBehalfOf();
  await AsyncStorage.clear();
});

describe("the Ledger pane", () => {
  it("shows Edit to the creator and not to the dispatcher", async () => {
    const creator = createFakeIms({ user: { writeReports: true } });
    populate(creator, { mayEditSummary: true });
    await renderPane(creator);
    expect(screen.getByTestId("ledger-summary-edit")).toBeTruthy();
  });

  it("shows no Edit when the server says the summary is not the viewer's", async () => {
    const dispatcher = createFakeIms({ user: { writeIncidents: true } });
    populate(dispatcher, { mayEditSummary: false, createdBy: 7 });
    await renderPane(dispatcher);
    expect(screen.queryByTestId("ledger-summary-edit")).toBeNull();
  });

  it("saves the summary on Enter", async () => {
    const fake = createFakeIms({ user: { writeReports: true } });
    populate(fake, { mayEditSummary: true });
    await renderPane(fake);
    await fireEvent.press(screen.getByTestId("ledger-summary-edit"));
    await typeInto("ledger-summary-field", "A better summary");
    await fireEvent(
      screen.getByTestId("ledger-summary-field"),
      "submitEditing",
    );
    await waitFor(() => expect(fake.updateReportRequests).toHaveLength(1));
    expect(fake.updateReportRequests[0]?.report?.summary).toBe(
      "A better summary",
    );
    expect(await screen.findByText("A better summary")).toBeTruthy();
    expect(screen.queryByTestId("ledger-summary-field")).toBeNull();
  });

  it("keeps the typed summary and shows the error under the field when the save fails", async () => {
    const fake = createFakeIms({ user: { writeReports: true } });
    populate(fake, { mayEditSummary: true });
    fake.behaviour.updateReport = { summary: "forbidden" };
    await renderPane(fake);
    await fireEvent.press(screen.getByTestId("ledger-summary-edit"));
    await typeInto("ledger-summary-field", "Will not stick");
    await fireEvent(
      screen.getByTestId("ledger-summary-field"),
      "submitEditing",
    );
    expect(await screen.findByText(/Couldn't save/)).toBeTruthy();
    expect(screen.getByTestId("ledger-summary-field").props.value).toBe(
      "Will not stick",
    );
  });

  it("links by number with Enter, and Detach unlinks", async () => {
    const fake = createFakeIms({ user: { writeReports: true } });
    populate(fake);
    await renderPane(fake);
    await fireEvent.press(screen.getByTestId("ledger-incident-link-open"));
    await typeInto("ledger-link-field", "214");
    await fireEvent(screen.getByTestId("ledger-link-field"), "submitEditing");
    await waitFor(() =>
      expect(fake.updateReportRequests[0]?.report?.incident).toBe(214),
    );
    await fireEvent.press(await screen.findByTestId("ledger-incident-detach"));
    await waitFor(() => expect(fake.updateReportRequests).toHaveLength(2));
    expect(fake.updateReportRequests[1]?.report?.incident).toBe(0);
    expect(await screen.findByTestId("ledger-incident-link-open")).toBeTruthy();
  });

  it("answers a missing incident number at the field, keeping the report unlinked", async () => {
    const fake = createFakeIms({ user: { writeReports: true } });
    populate(fake);
    await renderPane(fake);
    await fireEvent.press(screen.getByTestId("ledger-incident-link-open"));
    await typeInto("ledger-link-field", "999");
    await fireEvent(screen.getByTestId("ledger-link-field"), "submitEditing");
    expect(
      await screen.findByText("There's no incident #999 here."),
    ).toBeTruthy();
    expect(screen.getByTestId("ledger-link-field")).toBeTruthy();
    expect(screen.queryByTestId("ledger-incident-open")).toBeNull();
  });

  it("shows a private incident the viewer cannot read as a number that does not open", async () => {
    const fake = createFakeIms({ user: { writeReports: true } });
    populate(fake, { incident: 214, readable: false });
    const onOpenIncident = jest.fn();
    await renderPane(fake, { onOpenIncident });
    expect(await screen.findByText("Not visible to you")).toBeTruthy();
    expect(screen.getByTestId("ledger-incident-number")).toBeTruthy();
    expect(screen.queryByTestId("ledger-incident-open")).toBeNull();
    expect(onOpenIncident).not.toHaveBeenCalled();
  });

  it("treats an incident the viewer lacks the read bit for (403) the same as a private one", async () => {
    const fake = createFakeIms({ user: { writeReports: true } });
    populate(fake, { incident: 214 });
    fake.behaviour.getIncident = "forbidden";
    const onOpenIncident = jest.fn();
    await renderPane(fake, { onOpenIncident });
    expect(await screen.findByText("Not visible to you")).toBeTruthy();
    expect(screen.queryByTestId("ledger-incident-open")).toBeNull();
  });

  it("opens a readable incident and says nothing of visibility", async () => {
    const fake = createFakeIms();
    populate(fake, { incident: 214 });
    const onOpenIncident = jest.fn();
    await renderPane(fake, { onOpenIncident });
    await fireEvent.press(await screen.findByTestId("ledger-incident-open"));
    expect(onOpenIncident).toHaveBeenCalledWith(214);
    expect(screen.queryByText("Not visible to you")).toBeNull();
  });

  it("lists the journal newest first, hiding history and stricken entries until toggled", async () => {
    const fake = createFakeIms();
    populate(fake);
    await renderPane(fake);
    expect(screen.getByText("Newest")).toBeTruthy();
    expect(screen.getByText("Oldest")).toBeTruthy();
    expect(screen.queryByText("Linked to incident #214")).toBeNull();
    expect(screen.queryByText("Struck out")).toBeNull();
    const order = screen
      .getAllByText(/^(Newest|Oldest)$/)
      .map((n) => n.props.children);
    expect(order).toEqual(["Newest", "Oldest"]);

    await fireEvent(
      screen.getByTestId("ledger-toggle-history"),
      "valueChange",
      true,
    );
    expect(await screen.findByText("Linked to incident #214")).toBeTruthy();
    await fireEvent(
      screen.getByTestId("ledger-toggle-stricken"),
      "valueChange",
      true,
    );
    expect(await screen.findByText("Struck out")).toBeTruthy();
  });

  it("strikes the author's own entries, and others' only with writeIncidents", async () => {
    const reporter = createFakeIms({ user: { writeReports: true } });
    populate(reporter, { mayAddJournalEntry: true });
    await renderPane(reporter);
    // Own entry (author Dee) strikes; Priya's does not.
    expect(screen.getByTestId("strike-1")).toBeTruthy();
    expect(screen.queryByTestId("strike-2")).toBeNull();
    await fireEvent.press(screen.getByTestId("strike-1"));
    await waitFor(() =>
      expect(
        reporter.reports[0]?.report?.journalEntries.find((e) => e.id === 1)
          ?.stricken,
      ).toBe(true),
    );
  });

  it("lets a writer strike another's entry", async () => {
    const dispatcher = createFakeIms({ user: { writeIncidents: true } });
    populate(dispatcher, { mayAddJournalEntry: true });
    await renderPane(dispatcher);
    expect(screen.getByTestId("strike-1")).toBeTruthy();
    expect(screen.getByTestId("strike-2")).toBeTruthy();
    // A system entry is never struck.
    await fireEvent(
      screen.getByTestId("ledger-toggle-history"),
      "valueChange",
      true,
    );
    await screen.findByText("Linked to incident #214");
    expect(screen.queryByTestId("strike-3")).toBeNull();
  });

  it("shows a reader no chevron, Edit, Link…, composer or Strike", async () => {
    const reader = createFakeIms();
    populate(reader);
    await renderPane(reader);
    expect(screen.queryByTestId("ledger-summary-edit")).toBeNull();
    expect(screen.queryByTestId("ledger-incident-link-open")).toBeNull();
    expect(screen.queryByTestId("ledger-incident-detach")).toBeNull();
    expect(screen.queryByTestId("ledger-create-incident")).toBeNull();
    expect(screen.queryByTestId("report-composer")).toBeNull();
    expect(screen.queryByTestId("strike-1")).toBeNull();
    expect(screen.queryByText("›")).toBeNull();
    expect(screen.getByText("Created by")).toBeTruthy();
  });
});
