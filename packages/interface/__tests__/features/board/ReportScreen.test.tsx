// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
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

// The report screen's writing half (plan 09t): the docked composer with its
// on-behalf-of footer, the link that opens the incident, and a writer's two
// ways to attach an unattached report.

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

function populate(fake: FakeIms, incident?: number, mayAppend = true) {
  fake.events = [{ id: 1, name: "2026" }];
  fake.people = [
    create(PersonSchema, { personId: 11, handle: "Priya", name: "Priya R." }),
  ];
  fake.incidents = [
    makeIncidentView({
      incident: makeIncident({
        eventId: 1,
        number: 214,
        summary: "Lost child",
      }),
    }),
  ];
  fake.reports = [
    makeReportView({
      mayAddJournalEntry: mayAppend,
      report: makeReport({
        number: 38,
        summary: "What I saw",
        incident,
        journalEntries: [makeJournalEntry({ id: 1, text: "First" })],
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

function renderReport(
  runtime: Awaited<ReturnType<typeof signedInRuntime>>,
  handlers: Partial<{
    onOpenIncident: (n: number) => void;
    onCreateIncident: (summary: string) => void;
  }> = {},
) {
  return renderWithProviders(
    <ReportScreen
      eventId={1}
      number={38}
      onBack={() => undefined}
      onOpenIncident={handlers.onOpenIncident ?? (() => undefined)}
      onCreateIncident={handlers.onCreateIncident ?? (() => undefined)}
    />,
    runtime,
  );
}

afterEach(async () => {
  resetOnBehalfOf();
  await AsyncStorage.clear();
});

describe("ReportScreen", () => {
  it("appends an entry on behalf of someone through the docked composer", async () => {
    const fake = createFakeIms({ user: { writeReports: true } });
    populate(fake, 214);
    const runtime = await signedInRuntime(fake);
    await renderReport(runtime);
    await screen.findByTestId("report-composer");
    expect(screen.getByText("Posting as Dee")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("report-on-behalf-of-toggle"));
    await typeInto("composer-on-behalf-of", "pri");
    await fireEvent.press(
      await screen.findByTestId("composer-on-behalf-of-11"),
    );
    expect(screen.getByText("On behalf of Priya")).toBeTruthy();

    await typeInto("report-append-text", "Then the parent arrived.");
    await fireEvent.press(screen.getByTestId("report-append-send"));
    await waitFor(() => expect(fake.updateReportRequests).toHaveLength(1));
    const sent = fake.updateReportRequests[0]?.report;
    expect(sent?.journalEntries[0]?.text).toBe("Then the parent arrived.");
    expect(sent?.journalEntries[0]?.onBehalfOf?.personId).toBe(11);
    expect(sent?.summary).toBeUndefined();
    expect(sent?.incident).toBeUndefined();
    expect(await screen.findByText("Then the parent arrived.")).toBeTruthy();
  });

  it("has no composer when the caller may not add to the report", async () => {
    const fake = createFakeIms();
    populate(fake, 214, false);
    const runtime = await signedInRuntime(fake);
    await renderReport(runtime);
    await screen.findByTestId("report-number");
    expect(screen.queryByTestId("report-composer")).toBeNull();
  });

  it("opens the incident it is attached to", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    populate(fake, 214);
    const runtime = await signedInRuntime(fake);
    const onOpenIncident = jest.fn();
    await renderReport(runtime, { onOpenIncident });
    await fireEvent.press(await screen.findByTestId("report-incident-link"));
    expect(onOpenIncident).toHaveBeenCalledWith(214);
    expect(screen.queryByTestId("attach-incident")).toBeNull();
  });

  it("lets a writer attach an unattached report by number, with only the link on the wire", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderReport(runtime);
    await typeInto("attach-incident", "214");
    await fireEvent.press(screen.getByTestId("attach-incident-go"));
    await waitFor(() => expect(fake.updateReportRequests).toHaveLength(1));
    const sent = fake.updateReportRequests[0]?.report;
    expect(sent?.incident).toBe(214);
    expect(sent?.journalEntries).toHaveLength(0);
    expect(await screen.findByTestId("report-incident-link")).toBeTruthy();
  });

  it("hands the summary to the incident form for create-an-incident-from-this-report", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    populate(fake);
    const runtime = await signedInRuntime(fake);
    const onCreateIncident = jest.fn();
    await renderReport(runtime, { onCreateIncident });
    await fireEvent.press(
      await screen.findByTestId("create-incident-from-report"),
    );
    expect(onCreateIncident).toHaveBeenCalledWith("What I saw");
  });

  it("shows a reporter no attach controls on an unattached report", async () => {
    const fake = createFakeIms({ user: { writeReports: true } });
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderReport(runtime);
    await screen.findByTestId("report-number");
    expect(screen.queryByTestId("attach-incident")).toBeNull();
    expect(screen.queryByTestId("create-incident-from-report")).toBeNull();
  });
});
