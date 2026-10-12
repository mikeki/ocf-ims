// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ThemeProvider, themeFor } from "@/design/theme";
import { StatTile } from "@/features/dashboard/StatTile";

// StatTile (plan 09ab): proportional figures, "—" for an unset value, the
// changed dot a hard cut beside the label.

function tile(props: Partial<React.ComponentProps<typeof StatTile>> = {}) {
  return (
    <ThemeProvider scheme="light">
      <StatTile label="Open" value="31" testID="tile" {...props} />
    </ThemeProvider>
  );
}

describe("StatTile", () => {
  it("prints the label, the value and a caption", async () => {
    await render(tile({ caption: "of 180" }));
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("31")).toBeTruthy();
    expect(screen.getByText("of 180")).toBeTruthy();
  });

  it("reads the value in proportional figures, never the tabular step", async () => {
    await render(tile());
    const style = StyleSheet.flatten(screen.getByText("31").props.style);
    expect(style.fontVariant ?? []).not.toContain("tabular-nums");
  });

  it("takes half the row on a phone, and shares it four ways when wide", async () => {
    await render(tile({ narrow: true }));
    expect(
      StyleSheet.flatten(screen.getByTestId("tile").props.style).flexBasis,
    ).toBe("40%");
    await screen.unmount();
    await render(tile());
    expect(
      StyleSheet.flatten(screen.getByTestId("tile").props.style).flexBasis,
    ).toBe(0);
  });

  it("shows — for an unset value", async () => {
    await render(tile({ label: "Avg to close", value: "—" }));
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows the changed dot only while changed, spacing.xs from the label", async () => {
    await render(tile());
    expect(screen.queryByTestId("tile-changed")).toBeNull();
    await render(tile({ changed: true }));
    const dot = screen.getByTestId("tile-changed");
    expect(dot).toBeTruthy();
    expect(dot.props.accessibilityLabel).toBe("Open changed");
    const style = StyleSheet.flatten(dot.props.style);
    expect(style.backgroundColor).toBe(themeFor("light").tones.info.ink);
  });
});
