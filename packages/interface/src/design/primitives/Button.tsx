// SPDX-License-Identifier: Apache-2.0

import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";

// Button: three variants, a loading state that keeps the width and blocks
// presses, a disabled state (plan 09l F14), and the press feedback the motion
// budget allows (09o). `secondary` is drawn as an outlined control rather than
// a filled one — `borderStrong` clears 3:1, so the boundary is real.

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function Button(props: ButtonProps) {
  const {
    label,
    onPress,
    variant = "primary",
    loading = false,
    disabled = false,
  } = props;
  const theme = useTheme();
  const inactive = disabled || loading;
  const background =
    variant === "primary"
      ? theme.colors.primary
      : variant === "danger"
        ? theme.colors.danger
        : theme.colors.surface;
  const foreground =
    variant === "primary"
      ? "onPrimary"
      : variant === "danger"
        ? "onDanger"
        : "text";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
      testID={props.testID}
      style={{ opacity: inactive ? 0.6 : 1 }}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed && !inactive}
          style={[
            styles.base,
            {
              backgroundColor: background,
              borderColor:
                variant === "secondary"
                  ? theme.colors.borderStrong
                  : background,
              borderRadius: theme.radii.md,
              paddingHorizontal: theme.spacing.lg,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={theme.colors[foreground]} />
          ) : (
            <Text variant="label" color={foreground}>
              {label}
            </Text>
          )}
        </PressFeedback>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
});
