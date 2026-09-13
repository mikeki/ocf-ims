// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";

// The Board's docked "What's happening?" bar (plan 09r, the D2 pick): the
// affordance to file. It is drawn as a field but is a button — a tap
// anywhere on it pulls up the filing form, whose summary takes focus. A real
// input here would raise the keyboard under the modal.

export interface QuickBarProps {
  onFile: () => void;
  /** What a tap starts: an incident (the default) or a report (09t). */
  kind?: "incident" | "report";
}

const COPY = {
  incident: {
    a11y: "What's happening? Start a new incident",
    label: "What's happening?",
    hint: "One line to start an incident",
  },
  report: {
    a11y: "Something to report? Write a report",
    label: "Something to report?",
    hint: "One line to start a report",
  },
} as const;

export function QuickBar(props: QuickBarProps) {
  const theme = useTheme();
  const copy = COPY[props.kind ?? "incident"];
  return (
    <View
      style={[
        styles.dock,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          padding: theme.spacing.md,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.a11y}
        onPress={props.onFile}
        pressRetentionOffset={pressRetentionOffset}
        testID={props.kind === "report" ? "quick-bar-report" : "quick-bar"}
      >
        {({ pressed }) => (
          <PressFeedback pressed={pressed} style={{ gap: theme.spacing.xs }}>
            <Text variant="label" color="textMuted" aria-hidden>
              {copy.label}
            </Text>
            <View
              style={[
                styles.field,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.borderStrong,
                  borderRadius: theme.radii.md,
                  paddingHorizontal: theme.spacing.md,
                },
              ]}
            >
              <Text color="textMuted" aria-hidden>
                {copy.hint}
              </Text>
            </View>
          </PressFeedback>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  field: {
    minHeight: touchTarget,
    justifyContent: "center",
    borderWidth: 1,
  },
});
