// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "@/design/theme";
import { DayColumns } from "@/features/dashboard/DayColumns";

// DayColumns (plan 09ab): one gifted-charts column per day, the latest
// and the busiest labelled, a readout line, and a Table word that swaps the
// chart for a date · count list.

const days = [
  { date: "2026-07-03", count: 15 },
  { date: "2026-07-04", count: 22 },
  { date: "2026-07-05", count: 40 },
  { date: "2026-07-06", count: 13 },
];

const short = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

// The chart draws once the card is measured; Jest has no layout pass.
async function renderChart(testID = "days") {
  await render(chartOf(testID));
  await act(async () => {
    fireEvent(screen.getByTestId(testID).children[1] as never, "layout", {
      nativeEvent: { layout: { width: 320, height: 200, x: 0, y: 0 } },
    });
  });
}

function chartOf(testID = "days") {
  return (
    <ThemeProvider scheme="light">
      <DayColumns days={days} testID={testID} />
    </ThemeProvider>
  );
}

describe("DayColumns", () => {
  // BarChart schedules an internal label-opacity timer (unused while the chart
  // is not `isAnimated`) that would fire after the environment is torn down.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("labels the latest and the busiest day above their columns, the day of month under all", async () => {
    await renderChart();
    expect(screen.getAllByText(short("2026-07-06"))).toHaveLength(1);
    expect(screen.getAllByText(short("2026-07-05"))).toHaveLength(1);
    expect(screen.queryByText(short("2026-07-03"))).toBeNull();
    for (const n of ["3", "4", "5", "6"]) {
      expect(screen.getByText(n)).toBeTruthy();
    }
  });

  it("reads a pressed day out as date · count", async () => {
    await renderChart();
    expect(screen.getByText(`${short("2026-07-06")} · 13`)).toBeTruthy();
    await fireEvent.press(screen.getByText("4"));
    expect(screen.getByText(`${short("2026-07-04")} · 22`)).toBeTruthy();
  });

  it("swaps the chart for a date · count table and back", async () => {
    await renderChart();
    await fireEvent.press(screen.getByText("Table"));
    expect(screen.queryByText("5")).toBeNull();
    expect(screen.getByText(short("2026-07-03"))).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    await fireEvent.press(screen.getByText("Chart"));
    expect(await screen.findByText("5")).toBeTruthy();
  });

  it("says so when there are no days", async () => {
    await render(
      <ThemeProvider scheme="light">
        <DayColumns days={[]} />
      </ThemeProvider>,
    );
    expect(screen.getByText("No incidents yet")).toBeTruthy();
  });
});
