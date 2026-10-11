// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { PersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useReport } from "@/features/board/hooks";
import { resetOnBehalfOf } from "@/features/compose/hooks";
import { ReportComposer } from "@/features/compose/ReportComposer";
import { createFakeBlobs } from "@/test/fakeBlobs";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { createFakePhotoPicker } from "@/test/fakePhotoPicker";
import { makeReport, makeReportView } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The report composer's On behalf of row and its photo (plan 09z criterion 3),
// mounted on its own beside a live GetReport so a refetch is observable.

function Host() {
  useReport(1, 38);
  return (
    <ReportComposer
      eventId={1}
      number={38}
      author="Dee"
      eventName="Fair 2026"
      attachFiles
    />
  );
}

function reporterFake(): FakeIms {
  const fake = createFakeIms({ user: { writeReports: true } });
  fake.events = [{ id: 1, name: "Fair 2026" }];
  fake.people = [
    create(PersonSchema, { personId: 11, handle: "Kai", name: "Kai R." }),
  ];
  fake.reports = [
    makeReportView({
      mayAddJournalEntry: true,
      report: makeReport({ number: 38, summary: "Lost bag" }),
    }),
  ];
  return fake;
}

async function mount(fake: FakeIms) {
  const blobs = createFakeBlobs();
  const picker = createFakePhotoPicker(false);
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native", blobs });
  await runtime.session.bootstrap();
  await renderWithProviders(<Host />, runtime, undefined, picker);
  await screen.findByTestId("report-composer");
  return { blobs, runtime, picker };
}

async function typeInto(testID: string, text: string) {
  const input = screen.getByTestId(testID);
  await fireEvent.changeText(input, text);
  await fireEvent(input, "selectionChange", {
    nativeEvent: { selection: { start: text.length, end: text.length } },
  });
}

async function pickKai() {
  await fireEvent.press(screen.getByTestId("report-on-behalf-of-row"));
  await typeInto("composer-on-behalf-of", "kai");
  await fireEvent.press(await screen.findByTestId("composer-on-behalf-of-11"));
}

afterEach(async () => {
  resetOnBehalfOf();
  await AsyncStorage.clear();
});

describe("ReportComposer — On behalf of", () => {
  it("reads Yourself by default, picks Kai (Send for Kai) and Clear reverts", async () => {
    await mount(reporterFake());
    expect(screen.getByText("Yourself (Dee)")).toBeTruthy();
    expect(screen.getByText("Send")).toBeTruthy();
    expect(screen.queryByText("Posting as Dee")).toBeNull();
    expect(screen.queryByTestId("report-on-behalf-of-toggle")).toBeNull();

    await pickKai();
    expect(screen.getByText("Send for Kai")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("report-on-behalf-of-row"));
    await fireEvent.press(screen.getByTestId("composer-on-behalf-of-clear"));
    expect(screen.getByText("Yourself (Dee)")).toBeTruthy();
    expect(screen.getByText("Send")).toBeTruthy();
  });

  it("keeps the pick sticky across a send, on behalf of the picked person", async () => {
    const fake = reporterFake();
    await mount(fake);
    await pickKai();
    await typeInto("report-append-text", "Found it.");
    await fireEvent.press(screen.getByTestId("report-append-send"));
    await waitFor(() => expect(fake.updateReportRequests).toHaveLength(1));
    expect(
      fake.updateReportRequests[0]?.report?.journalEntries[0]?.onBehalfOf
        ?.personId,
    ).toBe(11);
    await waitFor(() =>
      expect(screen.getByTestId("report-append-text").props.value).toBe(""),
    );
    expect(screen.getByText("Send for Kai")).toBeTruthy();
  });
});

describe("ReportComposer — photo", () => {
  it("uploads through the report route after the entry lands, and GetReport refetches", async () => {
    const fake = reporterFake();
    const { blobs } = await mount(fake);
    await waitFor(() =>
      expect(fake.callsOf("GetReport").length).toBeGreaterThan(0),
    );
    const before = fake.callsOf("GetReport").length;

    await fireEvent.press(screen.getByTestId("photo-add"));
    await waitFor(() => expect(screen.getByTestId("photo-chip")).toBeTruthy());
    await typeInto("report-append-text", "With a photo.");
    await fireEvent.press(screen.getByTestId("report-append-send"));

    await waitFor(() => expect(blobs.uploads).toHaveLength(1));
    expect(blobs.uploads[0]?.kind).toBe("report");
    expect(blobs.uploads[0]).toMatchObject({
      eventName: "Fair 2026",
      number: 38,
    });
    expect(fake.updateReportRequests).toHaveLength(1);
    await waitFor(() =>
      expect(fake.callsOf("GetReport").length).toBeGreaterThan(before),
    );
  });
});
