// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "@/design/theme";
import { BarList, type BarListItem } from "@/features/dashboard/BarList";

// BarList (plan 09ab): label · bar · count rows (the bars are a gifted-charts
// BarChart, whose marks the tests cannot observe); a limit folds the tail into an in-place "N more"; labels wrap.

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

  it("sorts by count when asked, and keeps the given order otherwise", async () => {
    const shuffled = [items[3], items[0], items[1]] as BarListItem[];
    await render(list({ items: shuffled, sorted: true }));
    const labels = screen
      .getAllByText(/^(Medical|Security|Logistics)$/)
      .map((n) => n.props.children);
    expect(labels).toEqual(["Medical", "Security", "Logistics"]);
    await render(list({ items: shuffled }));
    const given = screen
      .getAllByText(/^(Medical|Security|Logistics)$/)
      .map((n) => n.props.children);
    expect(given.slice(-3)).toEqual(["Logistics", "Medical", "Security"]);
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

  it("derives the Top N caption from the limit, and drops it once expanded", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      key: `k${i}`,
      label: `Item ${i}`,
      count: 10 - i,
    }));
    await render(list({ items: many, limit: 3 }));
    expect(screen.getByText("Top 3")).toBeTruthy();
    await fireEvent.press(screen.getByText("2 more"));
    expect(screen.queryByText("Top 3")).toBeNull();
  });

  it("takes an empty label from the caller", async () => {
    await render(list({ items: [], emptyLabel: "No roles yet" }));
    expect(screen.getByText("No roles yet")).toBeTruthy();
    expect(screen.queryByText("No incidents yet")).toBeNull();
  });

  it("prints a caption, and a quiet line when empty", async () => {
    await render(list({ caption: "Top areas" }));
    expect(screen.getByText("Top areas")).toBeTruthy();
    await render(list({ items: [] }));
    expect(screen.getByText("No incidents yet")).toBeTruthy();
  });
});
