// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react-native";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Field } from "@/design/primitives/Field";
import { ListRow } from "@/design/primitives/ListRow";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { ThemeProvider } from "@/design/theme";
import type { ColorScheme } from "@/design/tokens";

// The seven primitives render in both schemes and behave (plan 09l F14;
// TextButton joined them in the 09o motion follow-up).

function Everything(props: {
  onPress: () => void;
  onRow: () => void;
  onWord: () => void;
}) {
  return (
    <Box p="lg" gap="md" bg="background" radius="md">
      <Text variant="title">Title</Text>
      <Text variant="caption" color="textMuted">
        Caption
      </Text>
      <Button label="Go" onPress={props.onPress} />
      <Button label="Busy" onPress={props.onPress} loading />
      <Field
        label="Email"
        value=""
        onChangeText={() => undefined}
        error="Required"
      />
      <ListRow
        title="Row"
        subtitle="Sub"
        right={<Badge label="open" tone="info" />}
        onPress={props.onRow}
      />
      <Badge label="private" tone="danger" />
      <TextButton label="Show password" onPress={props.onWord} />
    </Box>
  );
}

describe.each<ColorScheme>(["light", "dark"])("primitives in %s", (scheme) => {
  it("render and respond", async () => {
    const onPress = jest.fn();
    const onRow = jest.fn();
    const onWord = jest.fn();
    await render(
      <ThemeProvider scheme={scheme}>
        <Everything onPress={onPress} onRow={onRow} onWord={onWord} />
      </ThemeProvider>,
    );

    screen.getByText("Title");
    screen.getByText("Caption");
    screen.getByText("Required");
    screen.getByText("private");
    screen.getByText("open");

    await fireEvent.press(screen.getByText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByText("Row"));
    expect(onRow).toHaveBeenCalledTimes(1);

    // A TextButton is a real button to a screen reader, and pressing its
    // word reaches the Pressable wrapping it.
    screen.getByRole("button", { name: "Show password" });
    await fireEvent.press(screen.getByText("Show password"));
    expect(onWord).toHaveBeenCalledTimes(1);

    // A loading button shows a spinner instead of its label and blocks presses.
    expect(screen.queryByText("Busy")).toBeNull();
    expect(screen.getByRole("button", { busy: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { busy: true }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

it("useTheme outside a provider is a programming error", async () => {
  // Silence React's own report of the render error; the rejection is the assertion.
  const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await expect(render(<Text>orphan</Text>)).rejects.toThrow(/ThemeProvider/);
  } finally {
    spy.mockRestore();
  }
});
