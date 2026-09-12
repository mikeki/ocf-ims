// SPDX-License-Identifier: Apache-2.0

import { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, type Tone } from "@/design/tokens";

// A selectable chip for the filing form (plan 09r): the badge's tint when on,
// an outlined control when off. Not a design-system primitive until a second
// screen needs one.

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  tone?: Tone;
  testID?: string;
}

export function Chip(props: ChipProps) {
  const { label, selected, onPress, tone = "info" } = props;
  const theme = useTheme();
  const { ink, tint } = theme.tones[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
      hitSlop={{ top: theme.spacing.sm, bottom: theme.spacing.sm }}
      testID={props.testID}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.chip,
            {
              backgroundColor: selected ? tint : theme.colors.surface,
              borderColor: selected ? tint : theme.colors.borderStrong,
              borderRadius: theme.radii.pill,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
            },
          ]}
        >
          <Text
            variant="label"
            style={{ color: selected ? ink : theme.colors.textMuted }}
          >
            {label}
          </Text>
        </PressFeedback>
      )}
    </Pressable>
  );
}

export interface PriorityChipsProps {
  value: IncidentPriority;
  onChange: (priority: IncidentPriority) => void;
}

const PRIORITIES: [IncidentPriority, string, Tone][] = [
  [IncidentPriority.LOW, "Low", "neutral"],
  [IncidentPriority.NORMAL, "Normal", "info"],
  [IncidentPriority.HIGH, "High", "danger"],
];

export function PriorityChips(props: PriorityChipsProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.wrap, { gap: theme.spacing.sm }]}
    >
      {PRIORITIES.map(([priority, label, tone]) => (
        <Chip
          key={priority}
          label={label}
          tone={tone}
          selected={props.value === priority}
          onPress={() => props.onChange(priority)}
          testID={`priority-${label.toLowerCase()}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
});
