// SPDX-License-Identifier: Apache-2.0

import { View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// Badge: a small pill with a tone — the state / priority / private markers on
// a row (plan 09l F14). The state colour language proper comes with D0.

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

export function Badge(props: BadgeProps) {
  const { label, tone = "neutral" } = props;
  const theme = useTheme();
  const background =
    tone === "neutral" ? theme.colors.surfaceRaised : theme.colors[tone];
  const color = tone === "neutral" ? "text" : "onTone";
  return (
    <View
      accessibilityRole="text"
      style={{
        alignSelf: "flex-start",
        backgroundColor: background,
        borderRadius: theme.radii.pill,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
      }}
    >
      <Text variant="caption" color={color}>
        {label}
      </Text>
    </View>
  );
}
