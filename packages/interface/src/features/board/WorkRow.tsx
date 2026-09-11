// SPDX-License-Identifier: Apache-2.0

import { StyleSheet, View } from "react-native";
import { Badge } from "@/design/primitives/Badge";
import { ListRow } from "@/design/primitives/ListRow";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { label, type WorkItem, whyLabel } from "@/features/board/work";
import { formatShortTimeAt } from "@/lib/format";

// One row of the Board (plan 09q) on the D0 ledger row, with two marks: UNREAD
// (a labelled dot plus the identifier in full ink, so colour is never the only
// carrier) and YOURS (a rule down the leading edge, shown only where the list
// mixes yours with everyone's).

export interface WorkRowProps {
  item: WorkItem;
  unread: boolean;
  /** True in a list that mixes yours and everyone's, i.e. All. */
  showOwnership?: boolean;
  onPress: () => void;
}

export function WorkRow(props: WorkRowProps) {
  const { item, unread, showOwnership, onPress } = props;
  const theme = useTheme();
  const flagMine = Boolean(showOwnership) && item.mine;

  const row = (
    <ListRow
      title={item.summary}
      subtitle={subtitle(item, Boolean(showOwnership))}
      testID={`${item.kind}-row-${item.number}`}
      onPress={onPress}
      lead={
        <View style={[styles.lead, { gap: theme.spacing.sm }]}>
          <View
            accessible={unread}
            accessibilityLabel={unread ? "Unread" : undefined}
            style={[
              styles.dot,
              {
                backgroundColor: unread ? theme.colors.primary : "transparent",
              },
            ]}
          />
          <Text variant="figure" color={unread ? "text" : "textMuted"}>
            {label(item)}
          </Text>
        </View>
      }
      right={
        <Text variant="caption" color="textMuted">
          {formatShortTimeAt(item.changedAt)}
        </Text>
      }
      meta={
        <View style={[styles.meta, { gap: theme.spacing.xs }]}>
          {item.state === "open" ? <Badge label="Open" tone="info" /> : null}
          {item.state === "closed" ? (
            <Badge label="Closed" tone="neutral" />
          ) : null}
          {item.priority === "high" ? (
            <Badge label="High" tone="danger" />
          ) : null}
          {item.priority === "low" ? (
            <Badge label="Low" tone="neutral" />
          ) : null}
          {item.private ? <Badge label="Private" tone="restricted" /> : null}
        </View>
      }
    />
  );

  if (!flagMine) {
    return row;
  }
  return (
    <View
      accessibilityLabel="Yours"
      style={[styles.owned, { borderLeftColor: theme.colors.primary }]}
    >
      {row}
    </View>
  );
}

/** In a mixed list only your own rows spend the words on why they are yours. */
function subtitle(item: WorkItem, mixed: boolean): string {
  const where = item.where ?? "Report";
  if (mixed && !item.mine) {
    return where;
  }
  return `${where} · ${whyLabel[item.why]}`;
}

const styles = StyleSheet.create({
  lead: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  owned: {
    borderLeftWidth: 3,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
});
