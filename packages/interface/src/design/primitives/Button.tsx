//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { touchTarget } from "@/design/tokens";

// Button: three variants, a loading state that keeps the width and blocks
// presses, a disabled state (plan 09l F14).

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
        : theme.colors.surfaceRaised;
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
      testID={props.testID}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.lg,
          opacity: inactive ? 0.6 : pressed ? 0.85 : 1,
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
});
