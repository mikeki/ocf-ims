// SPDX-License-Identifier: Apache-2.0

import { StyleSheet, View } from "react-native";
import { Badge } from "@/design/primitives/Badge";
import { ListRow } from "@/design/primitives/ListRow";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { label, type WorkItem, whyLabel } from "@/features/board/work";
import { formatShortTimeAt } from "@/lib/format";

// One row of the Board (plan 09q, slice 3b.1), on the ledger row D0 built:
// the identifier is a COLUMN, the summary owns the first line, and the time is
// the fixed right column.
//
// Two marks this row adds to the 3a.3 incident row, each earning its place:
//
//   - UNREAD: a dot before the identifier, in the column that is already a
//     fixed width, so an unread row and a read row still line up. Colour is
//     never the only carrier — the dot is labelled, so the row's accessible
//     name begins "Unread", and the identifier goes from muted to full ink,
//     which survives a greyscale screen and direct sun.
//   - YOURS: a rule down the leading edge, shown only in a list that MIXES
//     (the All segment). Without it, at fair scale a read row of yours is
//     indistinguishable from a stranger's. It is deliberately not another
//     chip: it survives a fast scroll, costs the row no height, and cannot be
//     mistaken for the badges, which are all about the incident rather than
//     about you.

export interface WorkRowProps {
  item: WorkItem;
  unread: boolean;
  /** True in a list that mixes yours and everyone's — i.e. All. */
  showOwnership?: boolean;
  /** Absent = the row is not openable. Reports have no detail before 3b.3. */
  onPress?: () => void;
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

/**
 * In a mixed list only your own rows spend the extra words: the rule down the
 * edge says "yours", this says on what grounds. Everyone else's row stays as
 * short as it can be, which is most of what keeps hundreds of them scannable.
 */
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
