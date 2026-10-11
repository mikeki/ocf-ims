// SPDX-License-Identifier: Apache-2.0

import { EventPokeKind } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/stream_pb";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { ReportsScreen } from "@/features/reports/ReportsScreen";
import { Shell } from "@/features/shell/Shell";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { currentParams, pushed, resetFakeRouter } from "@/test/fakeRouter";
import {
  makeIncident,
  makeIncidentView,
  makeReport,
  makeReportView,
} from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// ReportsScreen composed inside Shell exactly as the reports index route does
// on a wide window (plan 09z criterion 7), over the real runtime and the
// fake. Routing is `src/test/fakeRouter.ts`. The window-level keyboard map is
// covered in useReportKeyboardMap.test.ts.

jest.mock("expo-router", () => require("@/test/fakeRouter"));

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

function populate(fake: FakeIms) {
  fake.events = [{ id: 1, name: "2026" }];
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
      report: makeReport({ number: 7, summary: "Unlinked seven" }),
    }),
    makeReportView({
      report: makeReport({ number: 9, summary: "Linked nine", incident: 214 }),
    }),
    makeReportView({
      report: makeReport({ number: 12, summary: "Unlinked twelve" }),
    }),
  ];
}

async function renderReports(
  runtime: Awaited<ReturnType<typeof signedInRuntime>>,
) {
  return renderWithProviders(
    <Shell eventId={1}>
      <ReportsScreen eventId={1} />
    </Shell>,
    runtime,
  );
}

function rowOrder(): number[] {
  return screen
    .getAllByTestId(/^report-row-\d+$/)
    .map((n) => Number((n.props.testID as string).replace("report-row-", "")));
}

async function pokeARow(fake: FakeIms) {
  await renderReports(await signedInRuntime(fake));
  await screen.findByText("Unlinked twelve");
  await waitFor(() => expect(fake.openStreams.length).toBeGreaterThan(0));
  fake.reports = fake.reports.map((v) =>
    v.report?.number === 12
      ? makeReportView({
          report: makeReport({ number: 12, summary: "Twelve, edited live" }),
        })
      : v,
  );
  await waitFor(
    () => {
      fake.poke({
        eventId: 1,
        kind: EventPokeKind.REPORT_CHANGED,
        reportNumber: 12,
      });
      expect(screen.getByText("Twelve, edited live")).toBeTruthy();
    },
    { timeout: 3000 },
  );
}

describe("ReportsScreen (wide layout)", () => {
  beforeEach(() => {
    resetFakeRouter();
  });

  it("opens on the Unlinked chip with Report# descending", async () => {
    const fake = createFakeIms();
    populate(fake);
    await renderReports(await signedInRuntime(fake));
    await screen.findByTestId("report-row-12");
    expect(rowOrder()).toEqual([12, 7]);
    expect(screen.queryByTestId("report-row-9")).toBeNull();
    // "—" is for a report with no incident; the linked one is not shown here.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("the Linked and All chips write link= and change the rows", async () => {
    const fake = createFakeIms();
    populate(fake);
    await renderReports(await signedInRuntime(fake));
    await screen.findByTestId("report-row-12");

    await fireEvent.press(screen.getByLabelText("Linked"));
    await waitFor(() =>
      expect(screen.getByTestId("report-row-9")).toBeTruthy(),
    );
    expect(currentParams().link).toBe("linked");
    expect(screen.queryByTestId("report-row-12")).toBeNull();
    expect(screen.getByText("214")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("All"));
    await waitFor(() => expect(rowOrder()).toEqual([12, 9, 7]));
  });

  it("sorts on a header press, then re-sorts on another column", async () => {
    const fake = createFakeIms();
    populate(fake);
    resetFakeRouter({ link: "all" });
    await renderReports(await signedInRuntime(fake));
    await screen.findByTestId("report-row-9");
    expect(rowOrder()).toEqual([12, 9, 7]);

    await fireEvent.press(screen.getByLabelText("Sort by Report#"));
    await waitFor(() => expect(rowOrder()).toEqual([7, 9, 12]));
    expect(currentParams().sort).toBe("number:asc");

    await fireEvent.press(screen.getByLabelText("Sort by Summary"));
    await waitFor(() => expect(currentParams().sort).toMatch(/^summary:/));
  });

  it("opens the drawer from open= and from a row press", async () => {
    const fake = createFakeIms();
    populate(fake);
    resetFakeRouter({ open: "7" });
    await renderReports(await signedInRuntime(fake));
    expect(await screen.findByTestId("report-drawer")).toBeTruthy();
    expect(await screen.findByTestId("ledger-summary-value")).toBeTruthy();
    expect(screen.getAllByText("R-7").length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByTestId("report-row-12"));
    await waitFor(() => expect(currentParams().open).toBe("12"));
  });

  it("a bare number plus Enter in the search opens that report", async () => {
    const fake = createFakeIms();
    populate(fake);
    await renderReports(await signedInRuntime(fake));
    await screen.findByTestId("report-row-12");
    const search = screen.getByTestId("report-search");
    await fireEvent.changeText(search, "7");
    await fireEvent(search, "submitEditing");
    await waitFor(() =>
      expect(screen.getByTestId("report-drawer")).toBeTruthy(),
    );
    expect(currentParams().open).toBe("7");
  });

  it("Full page pushes the report route carrying the query", async () => {
    const fake = createFakeIms();
    populate(fake);
    resetFakeRouter({ open: "7", link: "all" });
    await renderReports(await signedInRuntime(fake));
    await fireEvent.press(await screen.findByTestId("report-drawer-full"));
    expect(pushed).toContainEqual({
      pathname: "/events/1/reports/7",
      params: { from: "table", link: "all" },
    });
  });

  it("a live poke updates a row", async () => {
    const fake = createFakeIms();
    populate(fake);
    // The hub opens its stream only for a foregrounded app; Jest's AppState is not.
    const original = Object.getOwnPropertyDescriptor(AppState, "currentState");
    Object.defineProperty(AppState, "currentState", {
      value: "active",
      configurable: true,
      writable: true,
    });
    try {
      await pokeARow(fake);
    } finally {
      if (original) {
        Object.defineProperty(AppState, "currentState", original);
      }
    }
  });

  it("shows the Reports item always and no New report without writeReports", async () => {
    const fake = createFakeIms();
    populate(fake);
    await renderReports(await signedInRuntime(fake));
    await screen.findByTestId("report-row-12");
    expect(screen.getByTestId("shell-nav-reports")).toBeTruthy();
    expect(screen.queryByText("New report")).toBeNull();
  });

  it("shows New report with writeReports and navigates to the form", async () => {
    const fake = createFakeIms({ user: { writeReports: true } });
    populate(fake);
    await renderReports(await signedInRuntime(fake));
    await fireEvent.press(await screen.findByText("New report"));
    expect(pushed).toContain("/events/1/reports/new");
  });
});
