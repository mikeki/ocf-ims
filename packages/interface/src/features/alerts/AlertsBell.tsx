// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Badge } from "@/design/primitives/Badge";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";
import { useAlerts } from "@/features/alerts/hooks";

// The header's way to the alerts (plan 09u): a word and, when there are
// unread ones, their count as a chip. It polls the same list the screen
// shows, so the count and the list never disagree.

export interface AlertsBellProps {
  onPress: () => void;
}

export function AlertsBell(props: AlertsBellProps) {
  const theme = useTheme();
  const { data } = useAlerts();
  const unread = Number(data?.unread ?? 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
      onPress={props.onPress}
      pressRetentionOffset={pressRetentionOffset}
      hitSlop={{ top: theme.spacing.md, bottom: theme.spacing.md }}
      style={styles.hug}
      testID="alerts-bell"
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[styles.row, { gap: theme.spacing.xs }]}
        >
          <Text variant="label" color="primary">
            Alerts
          </Text>
          {unread > 0 ? <Badge label={String(unread)} tone="info" /> : null}
        </PressFeedback>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hug: { alignSelf: "center" },
  row: { flexDirection: "row", alignItems: "center" },
});
