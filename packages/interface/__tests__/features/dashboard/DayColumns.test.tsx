// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ThemeProvider } from "@/design/theme";
import { chart } from "@/design/tokens";
import { DayColumns } from "@/features/dashboard/DayColumns";

// DayColumns (plan 09ab): one chart.columnWidth column per day, the latest
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

function chartOf(testID = "days") {
  return (
    <ThemeProvider scheme="light">
      <DayColumns days={days} testID={testID} />
    </ThemeProvider>
  );
}

describe("DayColumns", () => {
  it("draws a chart.columnWidth column per day, tallest at the plot height", async () => {
    await render(chartOf());
    for (const d of days) {
      const style = StyleSheet.flatten(
        screen.getByTestId(`days-column-${d.date}`).props.style,
      );
      expect(style.width).toBe(chart.columnWidth);
    }
    const tallest = StyleSheet.flatten(
      screen.getByTestId("days-column-2026-07-05").props.style,
    );
    expect(tallest.height).toBe(chart.plotHeight);
  });

  it("labels the latest and the busiest day above their columns, the day of month under all", async () => {
    await render(chartOf());
    expect(screen.getAllByText(short("2026-07-06"))).toHaveLength(1);
    expect(screen.getAllByText(short("2026-07-05"))).toHaveLength(1);
    expect(screen.queryByText(short("2026-07-03"))).toBeNull();
    for (const n of ["3", "4", "5", "6"]) {
      expect(screen.getByText(n)).toBeTruthy();
    }
  });

  it("reads a pressed day out as date · count", async () => {
    await render(chartOf());
    expect(screen.getByText(`${short("2026-07-06")} · 13`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("days-day-2026-07-04"));
    expect(screen.getByText(`${short("2026-07-04")} · 22`)).toBeTruthy();
  });

  it("swaps the chart for a date · count table and back", async () => {
    await render(chartOf());
    await fireEvent.press(screen.getByText("Table"));
    expect(screen.queryByTestId("days-column-2026-07-05")).toBeNull();
    expect(screen.getByText(short("2026-07-03"))).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    await fireEvent.press(screen.getByText("Chart"));
    expect(screen.getByTestId("days-column-2026-07-05")).toBeTruthy();
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
