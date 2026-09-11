// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";

// The Board's segment picker (plan 09q, D1 → "Segmented"). Not a design-system
// primitive yet: it exists in exactly one place, and D0's rule is that a
// primitive earns its way in by being needed twice. If 3c's console wants one
// too, it moves to src/design/primitives then.
//
// A count rides on a segment only when that segment has something new, and it
// counts ONLY what that segment would list — a badge pointing at rows the
// filter removes sends you to a screen to look for them.

export interface Segment<K extends string> {
  key: K;
  label: string;
  /** Unread rows this segment would list. 0 or undefined shows no count. */
  count?: number;
}

export interface SegmentedControlProps<K extends string> {
  segments: Segment<K>[];
  current: K;
  onSelect: (key: K) => void;
}

export function SegmentedControl<K extends string>(
  props: SegmentedControlProps<K>,
) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
        },
      ]}
    >
      <View
        accessibilityRole="tablist"
        style={[
          styles.track,
          {
            backgroundColor: theme.colors.surfaceSunken,
            borderRadius: theme.radii.md,
            padding: theme.spacing.xs,
            gap: theme.spacing.xs,
          },
        ]}
      >
        {props.segments.map((segment) => (
          <SegmentButton
            key={segment.key}
            segment={segment}
            active={segment.key === props.current}
            onPress={() => props.onSelect(segment.key)}
          />
        ))}
      </View>
    </View>
  );
}

interface SegmentButtonProps<K extends string> {
  segment: Segment<K>;
  active: boolean;
  onPress: () => void;
}

function SegmentButton<K extends string>(props: SegmentButtonProps<K>) {
  const { segment, active, onPress } = props;
  const theme = useTheme();
  const count = segment.count ?? 0;
  return (
    <Pressable
      accessibilityRole="tab"
      // Both: `accessibilityState` is what React Native reads on a device, and
      // `aria-selected` is what the web build needs — RN Web does not map the
      // former to the latter for a tab, so without this a screen reader on the
      // web cannot tell which segment is the current one.
      accessibilityState={{ selected: active }}
      aria-selected={active}
      accessibilityLabel={
        count > 0 ? `${segment.label}, ${count} unread` : segment.label
      }
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
      style={styles.segment}
      testID={`board-segment-${segment.key}`}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.inner,
            {
              backgroundColor: active ? theme.colors.surface : "transparent",
              borderRadius: theme.radii.sm,
              paddingVertical: theme.spacing.sm,
              gap: theme.spacing.xs,
            },
            active ? theme.elevation[1] : null,
          ]}
        >
          <Text variant="label" color={active ? "text" : "textMuted"}>
            {segment.label}
          </Text>
          {count > 0 ? (
            <View
              aria-hidden
              style={[
                styles.count,
                {
                  backgroundColor: theme.tones.info.tint,
                  borderRadius: theme.radii.pill,
                  paddingHorizontal: theme.spacing.sm,
                },
              ]}
            >
              <Text variant="caption" style={{ color: theme.tones.info.ink }}>
                {count}
              </Text>
            </View>
          ) : null}
        </PressFeedback>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  track: {
    flexDirection: "row",
  },
  segment: {
    flex: 1,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  count: {
    alignItems: "center",
    justifyContent: "center",
  },
});
