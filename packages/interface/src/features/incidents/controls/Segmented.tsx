// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet, View } from "react-native";
import type { AppError } from "@/api/errors";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, type Tone, touchTarget } from "@/design/tokens";
import { FieldError } from "@/features/incidents/controls/bits";

// A segmented control for an enum with a colour language (plan 09y § The
// colour language, applied to controls): the selected segment carries its
// tone's tint and ink, the unselected ones sit on the surface behind a
// `border` rule; the track's own boundary is `borderStrong`. Disabled keeps
// the shape and drops the press. Left / right arrows move the selection
// when a segment has focus (web).

export interface SegmentOption<K extends string | number> {
  key: K;
  label: string;
  tone?: Tone;
}

export interface SegmentedProps<K extends string | number> {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  disabled?: boolean;
  error?: AppError;
  accessibilityLabel: string;
  testID?: string;
}

export function Segmented<K extends string | number>(props: SegmentedProps<K>) {
  const { options, value, onChange, disabled = false } = props;
  const theme = useTheme();
  const at = options.findIndex((o) => o.key === value);

  const onKeyDown = (e: { key: string; preventDefault(): void }) => {
    if (disabled) {
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = options[(at + delta + options.length) % options.length];
      if (next) {
        onChange(next.key);
      }
    }
  };

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={props.accessibilityLabel}
        testID={props.testID}
        {...({ onKeyDown } as object)}
        style={[
          styles.track,
          {
            borderColor: theme.colors.borderStrong,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.surface,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
      >
        {options.map((option, i) => {
          const selected = option.key === value;
          // No tone (Normal priority): the selected segment is raised, not tinted.
          const tone = option.tone
            ? theme.tones[option.tone]
            : { ink: theme.colors.text, tint: theme.colors.surfaceRaised };
          return (
            <Pressable
              key={String(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected, disabled }}
              accessibilityLabel={option.label}
              disabled={disabled}
              onPress={() => onChange(option.key)}
              pressRetentionOffset={pressRetentionOffset}
              style={styles.segment}
              testID={
                props.testID ? `${props.testID}-${option.key}` : undefined
              }
            >
              {({ pressed }) => (
                <PressFeedback
                  pressed={pressed && !disabled}
                  style={[
                    styles.inner,
                    {
                      backgroundColor: selected ? tone.tint : "transparent",
                      borderLeftWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderLeftColor: theme.colors.border,
                      paddingHorizontal: theme.spacing.lg,
                    },
                  ]}
                >
                  <Text
                    variant="label"
                    style={{
                      color: selected ? tone.ink : theme.colors.textMuted,
                    }}
                  >
                    {option.label}
                  </Text>
                </PressFeedback>
              )}
            </Pressable>
          );
        })}
      </View>
      <FieldError error={props.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignSelf: "flex-start",
    borderWidth: 1,
    overflow: "hidden",
  },
  segment: {
    minHeight: touchTarget - 2,
  },
  inner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
