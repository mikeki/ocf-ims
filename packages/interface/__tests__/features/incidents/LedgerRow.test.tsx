// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { ThemeProvider } from "@/design/theme";
import { LedgerRow } from "@/features/incidents/LedgerRow";

// The Ledger's row (plan 09y criterion 8): `label · value · ›`, a hard cut
// to the control on press for a writer, a hard cut back on `done`; a reader
// sees the same value with no chevron and no press.

async function renderRow(props: Partial<Parameters<typeof LedgerRow>[0]>) {
  await render(
    <ThemeProvider scheme="light">
      <LedgerRow
        label="State"
        value={<Text>Open</Text>}
        testID="state-value"
        {...props}
      />
    </ThemeProvider>,
  );
}

describe("LedgerRow", () => {
  it("a reader's row has no chevron and is not pressable", async () => {
    await renderRow({ may: false, control: () => <Text>CONTROL</Text> });

    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByText("›")).toBeNull();
    expect(screen.queryByTestId("state-value")).toBeNull();
    expect(screen.queryByLabelText("Edit state")).toBeNull();
  });

  it("a writer's row shows the chevron and is pressable", async () => {
    await renderRow({ may: true, control: () => <Text>CONTROL</Text> });

    expect(screen.getByText("›", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("state-value")).toBeTruthy();
    expect(screen.getByLabelText("Edit state")).toBeTruthy();
  });

  it("a read-only row (no control) is never pressable, even for a writer", async () => {
    await renderRow({ may: true, control: undefined });

    expect(screen.queryByText("›")).toBeNull();
    expect(screen.queryByTestId("state-value")).toBeNull();
  });

  it("a press swaps the value for the control in place", async () => {
    await renderRow({ may: true, control: () => <Text>CONTROL</Text> });

    await fireEvent.press(screen.getByTestId("state-value"));

    expect(screen.getByTestId("state-value-editing")).toBeTruthy();
    expect(screen.getByText("CONTROL")).toBeTruthy();
    expect(screen.queryByText("Open")).toBeNull();
  });

  it("done swaps the control back to the value", async () => {
    await renderRow({
      may: true,
      control: (done) => (
        <TextButton label="Done" onPress={done} testID="done" />
      ),
    });

    await fireEvent.press(screen.getByTestId("state-value"));
    await fireEvent.press(screen.getByTestId("done"));

    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.queryByTestId("state-value-editing")).toBeNull();
  });
});
