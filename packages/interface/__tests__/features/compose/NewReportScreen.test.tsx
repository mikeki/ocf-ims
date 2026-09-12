// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { PersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { resetOnBehalfOf } from "@/features/compose/hooks";
import { NewReportScreen } from "@/features/compose/NewReportScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import {
  makeIncident,
  makeIncidentView,
  makeReport,
  makeReportView,
} from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The report form against the real runtime and the fake's report RPCs (plan
// 09t, slice 3b.3b). Bootstrap before mounting (see IncidentScreen.test).

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

function reporterFake(user: Partial<FakeIms["user"]> = {}) {
  const fake = createFakeIms({ user: { writeReports: true, ...user } });
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
  return fake;
}

async function typeInto(testID: string, text: string) {
  const input = screen.getByTestId(testID);
  await fireEvent.changeText(input, text);
  await fireEvent(input, "selectionChange", {
    nativeEvent: { selection: { start: text.length, end: text.length } },
  });
}

afterEach(async () => {
  resetOnBehalfOf();
  await AsyncStorage.clear();
});

describe("NewReportScreen", () => {
  it("files a report on behalf of someone, linked to the incident it came from", async () => {
    const fake = reporterFake();
    const runtime = await signedInRuntime(fake);
    const onFiled = jest.fn();
    await renderWithProviders(
      <NewReportScreen
        eventId={1}
        incident={214}
        onCancel={() => undefined}
        onFiled={onFiled}
      />,
      runtime,
    );
    await screen.findByTestId("report-summary");
    // The link came from the incident: fixed, not a field.
    expect(screen.getByTestId("report-incident-fixed")).toHaveTextContent(
      "#214",
    );
    expect(screen.queryByTestId("report-incident")).toBeNull();

    await typeInto("report-summary", "What I saw at the gate");
    await typeInto("on-behalf-of", "pri");
    await fireEvent.press(await screen.findByTestId("on-behalf-of-11"));
    expect(screen.getByTestId("on-behalf-of-picked")).toHaveTextContent(
      "Priya",
    );
    await typeInto("report-details", "The child was found by the stage.");
    await fireEvent.press(screen.getByTestId("file-report"));

    await waitFor(() => expect(onFiled).toHaveBeenCalledWith(1));
    const filed = fake.reports[0]?.report;
    expect(filed?.summary).toBe("What I saw at the gate");
    expect(filed?.incident).toBe(214);
    expect(filed?.journalEntries[0]?.onBehalfOf?.personId).toBe(11);
    // The incident now shows the report as delivered on my row... once I am on it.
    expect(fake.incidents[0]?.incident?.reports).toEqual([1]);
  });

  it("keeps the on-behalf-of pick for the next report in the event, and clearing reverts to me", async () => {
    const fake = reporterFake();
    const runtime = await signedInRuntime(fake);
    const first = await renderWithProviders(
      <NewReportScreen
        eventId={1}
        onCancel={() => undefined}
        onFiled={() => undefined}
      />,
      runtime,
    );
    await screen.findByTestId("report-summary");
    await typeInto("on-behalf-of", "pri");
    await fireEvent.press(await screen.findByTestId("on-behalf-of-11"));
    await first.unmount();

    const second = await renderWithProviders(
      <NewReportScreen
        eventId={1}
        onCancel={() => undefined}
        onFiled={() => undefined}
      />,
      runtime,
    );
    expect(await screen.findByTestId("on-behalf-of-picked")).toHaveTextContent(
      "Priya",
    );
    await fireEvent.press(screen.getByTestId("on-behalf-of-clear"));
    expect(screen.queryByTestId("on-behalf-of-picked")).toBeNull();
    await typeInto("report-summary", "Just me");
    await typeInto("report-details", "Nothing to add.");
    await fireEvent.press(screen.getByTestId("file-report"));
    await waitFor(() => expect(fake.reports).toHaveLength(1));
    expect(
      fake.reports[0]?.report?.journalEntries[0]?.onBehalfOf,
    ).toBeUndefined();
    await second.unmount();
  });

  it("opens the instructions for a first report and leaves them shut once one is filed", async () => {
    const fake = reporterFake();
    const runtime = await signedInRuntime(fake);
    const first = await renderWithProviders(
      <NewReportScreen
        eventId={1}
        onCancel={() => undefined}
        onFiled={() => undefined}
      />,
      runtime,
    );
    expect(await screen.findByTestId("report-help-body")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("report-help-toggle"));
    expect(screen.queryByTestId("report-help-body")).toBeNull();
    await first.unmount();

    fake.reports = [
      makeReportView({
        report: makeReport({
          number: 3,
          createdBy: { personId: fake.user.personId, handle: "Dee" },
        }),
      }),
    ];
    await renderWithProviders(
      <NewReportScreen
        eventId={1}
        onCancel={() => undefined}
        onFiled={() => undefined}
      />,
      runtime,
    );
    await screen.findByTestId("report-help-toggle");
    expect(screen.queryByTestId("report-help-body")).toBeNull();
  });

  it("offers a writer the incident field and refuses an unknown number in place", async () => {
    const fake = reporterFake({ writeIncidents: true });
    const runtime = await signedInRuntime(fake);
    await renderWithProviders(
      <NewReportScreen
        eventId={1}
        onCancel={() => undefined}
        onFiled={() => undefined}
      />,
      runtime,
    );
    await typeInto("report-summary", "About an incident");
    await typeInto("report-incident", "999");
    await fireEvent.press(screen.getByTestId("file-report"));
    expect(
      await screen.findByText("There's no incident #999 in this event."),
    ).toBeTruthy();
    expect(fake.reports).toHaveLength(0);
  });

  it("refuses an empty summary without a round trip", async () => {
    const fake = reporterFake();
    const runtime = await signedInRuntime(fake);
    await renderWithProviders(
      <NewReportScreen
        eventId={1}
        onCancel={() => undefined}
        onFiled={() => undefined}
      />,
      runtime,
    );
    await screen.findByTestId("report-summary");
    await fireEvent.press(screen.getByTestId("file-report"));
    expect(
      await screen.findByText("Say what it is about, in one line."),
    ).toBeTruthy();
    expect(fake.callsOf("CreateReport")).toHaveLength(0);
  });
});
