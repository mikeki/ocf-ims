// SPDX-License-Identifier: Apache-2.0

import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { memo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Badge } from "@/design/primitives/Badge";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";
import { formatShortTime, priorityLabel, stateLabel } from "@/lib/format";
import type { Column } from "@/prototypes/dispatch/columns";
import {
  areaText,
  type Lookups,
  peopleText,
  typesText,
} from "@/prototypes/dispatch/state";

// The ONE row every variant shares (plan 09x), so the comparison is about
// shape and not about three row designs. One line, a fixed height (the
// windowed list needs `getItemLayout`), the number in the ledger column,
// and the colour language unchanged: Open carries `info`, High `danger`,
// Private `restricted`, Normal wears nothing. Selection is the focus ring
// `Field` draws plus a raised ground; hover is the ground alone.

export type Density = "compact" | "comfortable";

/**
 * Row height: one body line, its vertical padding (`sm` compact, `md`
 * comfortable) and the rule. Fixed, so the list can window on it.
 */
export function rowHeight(lineHeight: number, pad: number) {
  return lineHeight + 2 * pad + StyleSheet.hairlineWidth;
}

export interface IncidentRowProps {
  incident: Incident;
  columns: Column[];
  lookups: Lookups;
  selected: boolean;
  height: number;
  onPress: () => void;
}

export const IncidentRow = memo(function IncidentRow(props: IncidentRowProps) {
  const { incident, columns, lookups, selected, height, onPress } = props;
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const state = stateLabel(incident.state);
  const priority = priorityLabel(incident.priority);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`#${incident.number} ${incident.summary ?? ""}`}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      pressRetentionOffset={pressRetentionOffset}
      testID={`dispatch-row-${incident.number}`}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.row,
            {
              height,
              paddingHorizontal: theme.spacing.lg,
              gap: theme.spacing.md,
              borderBottomColor: theme.colors.border,
              backgroundColor:
                selected || hovered
                  ? theme.colors.surfaceRaised
                  : theme.colors.surface,
              boxShadow: selected
                ? `inset 0 0 0 2px ${theme.colors.focusRing}`
                : undefined,
            },
          ]}
        >
          {columns.map((column) => (
            <View
              key={column.key}
              style={[
                column.width === undefined
                  ? styles.flexCell
                  : { width: column.width },
                column.align === "right" ? styles.right : null,
              ]}
            >
              {cell(column, incident, lookups, selected)}
            </View>
          ))}
        </PressFeedback>
      )}
    </Pressable>
  );

  function cell(
    column: Column,
    row: Incident,
    lookups: Lookups,
    isSelected: boolean,
  ) {
    switch (column.key) {
      case "number":
        return (
          <Text variant="figure" color={isSelected ? "primary" : "text"}>
            {row.number}
          </Text>
        );
      case "state":
        return (
          <View style={[styles.marks, { gap: theme.spacing.xs }]}>
            {state ? <Badge label={state.label} tone={state.tone} /> : null}
            {row.private ? <Badge label="Private" tone="restricted" /> : null}
          </View>
        );
      case "priority":
        return priority ? (
          <Badge label={priority.label} tone={priority.tone} />
        ) : null;
      case "types":
        return (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {typesText(row, lookups)}
          </Text>
        );
      case "area":
        return (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {areaText(row, lookups)}
          </Text>
        );
      case "summary":
        return (
          <Text variant="body" numberOfLines={1}>
            {row.summary ?? ""}
          </Text>
        );
      case "started":
        return (
          <Text variant="caption" color="textMuted">
            {formatShortTime(row.started)}
          </Text>
        );
      case "modified":
        return (
          <Text variant="caption" color="textMuted">
            {formatShortTime(row.lastModified)}
          </Text>
        );
      case "people":
        return (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {peopleText(row)}
          </Text>
        );
    }
  }
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flexCell: {
    flex: 1,
    minWidth: 0,
  },
  right: {
    alignItems: "flex-end",
  },
  marks: {
    flexDirection: "row",
    alignItems: "center",
  },
});
