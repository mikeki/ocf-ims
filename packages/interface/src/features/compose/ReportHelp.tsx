// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";

// "How to write a great report" (plan 09t): the templ client's instructions
// as a collapsible section. Open by default for a first report; the toggle
// swaps the content with no animation (it is a 100-times-a-fair control for
// dispatch, and a once-a-fair read for a reporter).

export interface ReportHelpProps {
  open: boolean;
  onToggle: (open: boolean) => void;
}

const INCLUDE = [
  "Time and date of the incident",
  "Location of the incident",
  "The report's author, if you are entering it for someone else",
  "Names of others present",
  "Identifying details for law enforcement and other officials: the agency, badge numbers, vehicle plates, make and colour",
];

const FACTS = [
  "Write about what you did, saw and heard yourself, not what you think may have happened.",
  "Include what people told you, and note who said what.",
  "Keep what you are saying apart from what you heard others say.",
];

export function ReportHelp(props: ReportHelpProps) {
  const { open, onToggle } = props;
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radii.lg,
        overflow: "hidden",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="How to write a great report"
        onPress={() => onToggle(!open)}
        pressRetentionOffset={pressRetentionOffset}
        testID="report-help-toggle"
      >
        {({ pressed }) => (
          <PressFeedback
            pressed={pressed}
            style={[styles.header, { paddingHorizontal: theme.spacing.lg }]}
          >
            <Text variant="label">How to write a great report</Text>
            <Text variant="label" color="textMuted" aria-hidden>
              {open ? "Hide" : "Show"}
            </Text>
          </PressFeedback>
        )}
      </Pressable>
      {open ? (
        <Box
          px="lg"
          gap="md"
          style={{ paddingBottom: theme.spacing.lg }}
          testID="report-help-body"
        >
          <Text>
            Start with a summary, then give a thorough account of what happened
            in the details.
          </Text>
          <Box gap="xs">
            <Text variant="label" color="textMuted">
              Include
            </Text>
            {INCLUDE.map((line) => (
              <Text key={line}>{`• ${line}`}</Text>
            ))}
          </Box>
          <Box gap="xs">
            <Text variant="label" color="textMuted">
              Stick to facts
            </Text>
            {FACTS.map((line) => (
              <Text key={line}>{`• ${line}`}</Text>
            ))}
          </Box>
          <Text>
            Write everything you can remember, in as much detail as you can. A
            long report is fine; keep it clear, and skip jargon and acronyms.
          </Text>
        </Box>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
