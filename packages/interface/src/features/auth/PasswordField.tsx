// SPDX-License-Identifier: Apache-2.0

import { Box } from "@/design/primitives/Box";
import { Field, type FieldProps } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";

// A Field that hides its value by default, with a text-button toggle (plan
// 09n). `shown`/`onToggleShown` are controlled by the caller rather than
// owned here, so the forced password-change screen's two fields (New /
// Confirm) can share one show/hide state.

export type PasswordFieldProps = Omit<FieldProps, "secureTextEntry"> & {
  shown: boolean;
  onToggleShown: () => void;
};

export function PasswordField(props: PasswordFieldProps) {
  const { shown, onToggleShown, ...field } = props;
  return (
    <Box gap="sm">
      <Field {...field} secureTextEntry={!shown} />
      <Text
        accessibilityRole="button"
        variant="label"
        color="primary"
        onPress={onToggleShown}
      >
        {shown ? "Hide password" : "Show password"}
      </Text>
    </Box>
  );
}
