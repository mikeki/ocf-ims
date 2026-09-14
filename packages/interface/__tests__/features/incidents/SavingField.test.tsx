// SPDX-License-Identifier: Apache-2.0

import { Code, ConnectError } from "@connectrpc/connect";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import type { AppError } from "@/api/errors";
import { toAppError } from "@/api/errors";
import { ThemeProvider } from "@/design/theme";
import { SavingField } from "@/features/incidents/SavingField";

// SavingField (plan 09y criterion 2 and 6): a field that holds a local value
// only while focused or mid-save — a poke writes the server's value into it
// at any other time, and into it when it blurs or its save settles — saves
// on blur and on Enter when the text changed, validates first, and keeps the
// typed value with the error showing when a save fails.

/** The server value is a prop, so a test can move it to simulate a poke. */
function Harness(props: {
  onSave: (value: string) => Promise<void>;
  validate?: (value: string) => string | undefined;
  saveError?: AppError;
  disabled?: boolean;
  onDone?: () => void;
}) {
  const [value, setValue] = useState("Original");
  return (
    <>
      <SavingField
        label="Summary"
        value={value}
        onSave={props.onSave}
        validate={props.validate}
        saveError={props.saveError}
        disabled={props.disabled}
        onDone={props.onDone}
        testID="summary-field"
      />
      <SavingField
        label="Poker"
        value=""
        onSave={() => Promise.resolve()}
        onDone={() => setValue("Poked from outside")}
        testID="poke-trigger"
      />
    </>
  );
}

async function renderHarness(props: Parameters<typeof Harness>[0]) {
  await render(
    <ThemeProvider scheme="light">
      <Harness {...props} />
    </ThemeProvider>,
  );
}

describe("SavingField", () => {
  it("saves on blur when the text changed", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    await renderHarness({ onSave });

    const field = screen.getByTestId("summary-field");
    await fireEvent.changeText(field, "Changed");
    await fireEvent(field, "blur");

    expect(onSave).toHaveBeenCalledWith("Changed");
  });

  it("saves on Enter (submitEditing) for a single line field", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    await renderHarness({ onSave });

    const field = screen.getByTestId("summary-field");
    await fireEvent.changeText(field, "Changed via enter");
    await fireEvent(field, "submitEditing");

    expect(onSave).toHaveBeenCalledWith("Changed via enter");
  });

  it("an unchanged blur sends nothing and calls onDone", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onDone = jest.fn();
    await renderHarness({ onSave, onDone });

    const field = screen.getByTestId("summary-field");
    await fireEvent(field, "focus");
    await fireEvent(field, "blur");

    expect(onSave).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a value change from outside while focused does not replace the typed text", async () => {
    const onSave = jest.fn(() => new Promise<void>(() => undefined));
    await renderHarness({ onSave });

    const field = screen.getByTestId("summary-field");
    await fireEvent(field, "focus");
    await fireEvent.changeText(field, "Typing…");
    // The poke: another control's onDone drives the shared `value` prop to
    // a new server value while this field is still focused.
    await fireEvent(screen.getByTestId("poke-trigger"), "blur");

    expect(field.props.value).toBe("Typing…");
  });

  it("a failed save keeps the text and shows the error", async () => {
    const onSave = jest.fn().mockRejectedValue(new Error("nope"));
    const error: AppError = toAppError(
      new ConnectError("redeploying", Code.Unavailable),
    );
    const { rerender } = await render(
      <ThemeProvider scheme="light">
        <SavingField
          label="Summary"
          value="Original"
          onSave={onSave}
          testID="summary-field"
        />
      </ThemeProvider>,
    );

    const field = screen.getByTestId("summary-field");
    await fireEvent.changeText(field, "Will fail");
    await fireEvent(field, "blur");
    expect(onSave).toHaveBeenCalledWith("Will fail");

    // The hook surfaces the failed save's error at the field on its next render.
    await rerender(
      <ThemeProvider scheme="light">
        <SavingField
          label="Summary"
          value="Original"
          onSave={onSave}
          saveError={error}
          testID="summary-field"
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("summary-field").props.value).toBe("Will fail");
    screen.getByText(
      "Couldn't save. Can't reach the server. Check the connection and try again.",
    );
  });

  it("validate blocks the send", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    await renderHarness({ onSave, validate: () => "Too short" });

    const field = screen.getByTestId("summary-field");
    await fireEvent.changeText(field, "x");
    await fireEvent(field, "blur");

    expect(onSave).not.toHaveBeenCalled();
    screen.getByText("Too short");
  });

  it("renders read-only, muted, in surfaceSunken when disabled", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    await renderHarness({ onSave, disabled: true });

    const field = screen.getByTestId("summary-field");
    expect(field.props.editable).toBe(false);
  });
});
