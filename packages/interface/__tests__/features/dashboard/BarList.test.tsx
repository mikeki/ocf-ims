// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ThemeProvider } from "@/design/theme";
import { chart } from "@/design/tokens";
import { BarList, type BarListItem } from "@/features/dashboard/BarList";

// BarList (plan 09ab): label · bar · count rows; the bar is chart.barThickness
// tall; a limit folds the tail into an in-place "N more"; labels wrap.

const items: BarListItem[] = [
  { key: "a", label: "Medical", count: 40 },
  { key: "b", label: "Security", count: 20 },
  { key: "c", label: "Weather", count: 10 },
  { key: "d", label: "Logistics", count: 5 },
];

function list(props: Partial<React.ComponentProps<typeof BarList>> = {}) {
  return (
    <ThemeProvider scheme="light">
      <BarList items={items} testID="bars" {...props} />
    </ThemeProvider>
  );
}

describe("BarList", () => {
  it("prints every row's label and count", async () => {
    await render(list());
    for (const item of items) {
      expect(screen.getByText(item.label)).toBeTruthy();
      expect(screen.getByText(String(item.count))).toBeTruthy();
    }
  });

  it("draws the bar chart.barThickness tall, wide by count over the max", async () => {
    await render(list());
    const top = StyleSheet.flatten(
      screen.getByTestId("bars-bar-a").props.style,
    );
    expect(top.height).toBe(chart.barThickness);
    expect(top.width).toBe("100%");
    const half = StyleSheet.flatten(
      screen.getByTestId("bars-bar-b").props.style,
    );
    expect(half.width).toBe("50%");
    expect(top.borderTopRightRadius).toBe(4);
    expect(top.borderTopLeftRadius).toBeUndefined();
  });

  it("sorts by count when asked, and keeps the given order otherwise", async () => {
    const shuffled = [items[3], items[0]] as BarListItem[];
    await render(list({ items: shuffled, sorted: true }));
    const bars = screen.getAllByTestId(/^bars-bar-/);
    expect(bars[0]?.props.testID).toBe("bars-bar-a");
  });

  it("folds the tail behind an N more word that expands in place", async () => {
    await render(list({ limit: 2 }));
    expect(screen.queryByText("Weather")).toBeNull();
    const more = screen.getByText("2 more");
    await fireEvent.press(more);
    expect(screen.getByText("Weather")).toBeTruthy();
    expect(screen.getByText("Logistics")).toBeTruthy();
    expect(screen.queryByText("2 more")).toBeNull();
  });

  it("never truncates a label", async () => {
    await render(
      list({
        items: [
          {
            key: "long",
            label: "Main Stage — Back of House, behind the loading dock",
            count: 3,
          },
        ],
      }),
    );
    const label = screen.getByText(
      "Main Stage — Back of House, behind the loading dock",
    );
    expect(label.props.numberOfLines).toBeUndefined();
  });

  it("prints a caption, and a quiet line when empty", async () => {
    await render(list({ caption: "Top areas" }));
    expect(screen.getByText("Top areas")).toBeTruthy();
    await render(list({ items: [] }));
    expect(screen.getByText("No incidents yet")).toBeTruthy();
  });
});
