// SPDX-License-Identifier: Apache-2.0

import { StyleSheet, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import type { Tone } from "@/design/tokens";

// Badge: the state / priority / private marker on a row (plan 09l F14),
// drawn as a tinted chip — the tone's ink on an opaque wash of itself — so a
// row carrying three of them stays calm (D0 / DESIGN.md § The colour
// language). The label is always the word: colour is never the only carrier.

export type BadgeTone = Tone;

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

export function Badge(props: BadgeProps) {
  const { label, tone = "neutral" } = props;
  const theme = useTheme();
  const { ink, tint } = theme.tones[tone];
  return (
    <View
      accessibilityRole="text"
      style={[
        styles.chip,
        {
          backgroundColor: tint,
          borderRadius: theme.radii.pill,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        },
      ]}
    >
      <Text variant="label" style={{ color: ink }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
  },
});
