// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "@/design/theme";
import { dispatchHelpRows, HelpSheet } from "@/features/dispatch/HelpSheet";

// The sheet draws whatever rows it is handed; dispatch hands it today's.

function sheet(rows: [string, string][]) {
  return render(
    <ThemeProvider scheme="light">
      <HelpSheet open onClose={() => undefined} rows={rows} />
    </ThemeProvider>,
  );
}

describe("HelpSheet", () => {
  it("renders the rows it is given", async () => {
    await sheet([["x", "Do the thing"]]);
    expect(screen.getByText("x")).toBeTruthy();
    expect(screen.getByText("Do the thing")).toBeTruthy();
    expect(screen.queryByText("New incident")).toBeNull();
  });

  it("dispatch's rows carry the n row only for a writer", () => {
    expect(dispatchHelpRows(true).some(([k]) => k === "n")).toBe(true);
    expect(dispatchHelpRows(false).some(([k]) => k === "n")).toBe(false);
  });
});
