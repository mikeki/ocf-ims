// SPDX-License-Identifier: Apache-2.0

import { useId } from "react";
import type { TextInputProps } from "react-native";
import { StyleSheet, TextInput, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { touchTarget } from "@/design/tokens";

// Field: a labelled text input with an error line — the shape a protovalidate
// violation lands in (plan 09l F12/F14). Everything TextInput accepts passes
// through (secureTextEntry, autoCapitalize, keyboardType, …).

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export function Field(props: FieldProps) {
  const { label, error, style, ...input } = props;
  const theme = useTheme();
  const id = useId();
  const borderColor = error ? theme.colors.danger : theme.colors.border;
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
        style={[
          styles.input,
          theme.type.body,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.md,
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
  },
});
