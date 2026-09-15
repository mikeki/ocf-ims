// SPDX-License-Identifier: Apache-2.0

import { Pressable, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// `open_follow_ups` (docs/plans/09ab-dashboard-design.md § The forms): a list
// of incident rows, the number a fixed tabular column, that open the
// incident. Where that opens is an open decision (§ Decisions the round must
// also take 4) — the round only judges placement, so `onOpen` here is
// whatever the harness wired (a console log).

export interface FollowUpItem {
  incidentNumber: number;
  summary: string;
}

export interface FollowUpsProps {
  items: FollowUpItem[];
  onOpen: (incidentNumber: number) => void;
  testID?: string;
}

export function FollowUps(props: FollowUpsProps) {
  const { items, onOpen, testID } = props;
  const theme = useTheme();

  if (items.length === 0) {
    return (
      <Text variant="body" color="textMuted" testID={testID}>
        No follow-ups owed
      </Text>
    );
  }

  return (
    <View style={{ gap: theme.spacing.xs }} testID={testID}>
      {items.map((item) => (
        <Pressable
          key={item.incidentNumber}
          accessibilityRole="button"
          accessibilityLabel={`Open incident ${item.incidentNumber}`}
          onPress={() => onOpen(item.incidentNumber)}
        >
          {({ pressed }) => (
            <PressFeedback
              pressed={pressed}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: theme.spacing.sm,
                paddingVertical: theme.spacing.xs,
              }}
            >
              <Text
                variant="figure"
                style={{ minWidth: theme.spacing.xxl * 1.5 }}
              >
                {item.incidentNumber}
              </Text>
              <Text variant="body" style={{ flex: 1 }} numberOfLines={2}>
                {item.summary}
              </Text>
            </PressFeedback>
          )}
        </Pressable>
      ))}
    </View>
  );
}
