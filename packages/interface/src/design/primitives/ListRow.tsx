// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import {
  ledgerColumn,
  pressRetentionOffset,
  touchTarget,
} from "@/design/tokens";

// ListRow: the ledger row this direction is built around (D0 / DESIGN.md).
// Four slots, and a row uses only the ones it has:
//
//   lead  │ title (up to two lines)                    │ right
//         │ subtitle          meta                     │
//
// `lead` is the fixed left column — an incident number in tabular figures —
// and `right` the fixed right one (its time). `meta` sits beside the subtitle
// on the second line, which is where a row's badges go. With a `lead` the row
// is top-aligned, so the number sits level with the first line of the title;
// without one (the events list) everything centres as before.

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** The fixed left column: an incident number. */
  lead?: ReactNode;
  /** The fixed right column: a time, a count. */
  right?: ReactNode;
  /** Second-line accessories, after the subtitle: the badges. */
  meta?: ReactNode;
  onPress?: () => void;
  testID?: string;
}

export function ListRow(props: ListRowProps) {
  const theme = useTheme();
  const hasSecondLine = Boolean(props.subtitle || props.meta);
  const content = (
    <View
      style={[
        styles.row,
        props.lead ? styles.top : styles.middle,
        {
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.md,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      {props.lead ? <View style={styles.lead}>{props.lead}</View> : null}
      <View style={[styles.body, { gap: theme.spacing.xs }]}>
        <Text variant="body" numberOfLines={2}>
          {props.title}
        </Text>
        {hasSecondLine ? (
          <View style={[styles.secondLine, { gap: theme.spacing.sm }]}>
            {props.subtitle ? (
              <Text variant="caption" color="textMuted" numberOfLines={1}>
                {props.subtitle}
              </Text>
            ) : null}
            {props.meta}
          </View>
        ) : null}
      </View>
      {props.right ? <View>{props.right}</View> : null}
    </View>
  );
  if (!props.onPress) {
    return content;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      pressRetentionOffset={pressRetentionOffset}
      testID={props.testID}
    >
      {({ pressed }) => (
        <PressFeedback pressed={pressed}>{content}</PressFeedback>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  top: {
    alignItems: "flex-start",
  },
  middle: {
    alignItems: "center",
  },
  lead: {
    minWidth: ledgerColumn,
  },
  body: {
    flex: 1,
  },
  secondLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
});
