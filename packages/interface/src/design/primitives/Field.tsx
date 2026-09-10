// SPDX-License-Identifier: Apache-2.0

import { useId, useState } from "react";
import type { TextInputProps } from "react-native";
import { StyleSheet, TextInput, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { touchTarget } from "@/design/tokens";

// Field: a labelled text input with an error line — the shape a protovalidate
// violation lands in (plan 09l F12/F14). Everything TextInput accepts passes
// through (secureTextEntry, autoCapitalize, keyboardType, …).
//
// At rest the boundary is `borderStrong`, not `border`: a control's edge has
// to be perceivable (3:1), and `border` is a decorative rule that deliberately
// is not. Focus paints the ring in `focusRing` — a shadow, not a wider border,
// so a keyboard user tabbing through the form never shifts the layout.

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export function Field(props: FieldProps) {
  const { label, error, style, onFocus, onBlur, ...input } = props;
  const theme = useTheme();
  const id = useId();
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.focus
      : theme.colors.borderStrong;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label" color="textMuted" nativeID={id}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityLabelledBy={id}
        placeholderTextColor={theme.colors.textMuted}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          theme.type.body,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.md,
            boxShadow: focused
              ? `0 0 0 3px ${theme.colors.focusRing}`
              : undefined,
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    // The browser's own focus ring would sit on top of ours.
    outlineWidth: 0,
  },
});
