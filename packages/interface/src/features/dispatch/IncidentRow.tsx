// SPDX-License-Identifier: Apache-2.0

import { memo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Badge } from "@/design/primitives/Badge";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";
import type { Column } from "@/features/dispatch/columns";
import {
  areaText,
  type Lookups,
  peopleText,
  type Row,
  typesText,
} from "@/features/dispatch/query";
import { formatShortTime, priorityLabel, stateLabel } from "@/lib/format";

// The one incident row (plan 09x criterion 3), promoted from
// src/prototypes/dispatch/IncidentRow.tsx: one line, a fixed height (the
// list windows on it), the number in the ledger column, and the colour
// language unchanged — Open carries `info`, High `danger`, Private
// `restricted`, Normal wears nothing. `Density` is dropped: comfortable is
// the only row this slice ships (a preference is 3c.6's).

/**
 * Row height: one body line, its vertical padding and the rule. Fixed, so
 * the list can window on it.
 */
export function rowHeight(lineHeight: number, pad: number): number {
  return lineHeight + 2 * pad + StyleSheet.hairlineWidth;
}

export interface IncidentRowProps {
  view: Row;
  columns: Column[];
  lookups: Lookups;
  selected: boolean;
  height: number;
  /**
   * Takes the incident's number rather than being pre-bound to it, so every
   * row can share the same function reference and `memo` below actually
   * skips the rows a keystroke or a poke did not touch (finding 2's cousin,
   * plan 09x code review).
   */
  onPress: (number: number) => void;
}

export const IncidentRow = memo(function IncidentRow(props: IncidentRowProps) {
  const { view, columns, lookups, selected, height, onPress } = props;
  const incident = view.incident;
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const state = stateLabel(incident.state);
  const priority = priorityLabel(incident.priority);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`#${incident.number} ${incident.summary ?? ""}`}
      onPress={() => onPress(incident.number)}
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
              {cell(column)}
            </View>
          ))}
        </PressFeedback>
      )}
    </Pressable>
  );

  function cell(column: Column) {
    switch (column.key) {
      case "number":
        return (
          <Text variant="figure" color={selected ? "primary" : "text"}>
            {incident.number}
          </Text>
        );
      case "state":
        return (
          <View style={[styles.marks, { gap: theme.spacing.xs }]}>
            {state ? <Badge label={state.label} tone={state.tone} /> : null}
            {incident.private ? (
              <Badge label="Private" tone="restricted" />
            ) : null}
          </View>
        );
      case "priority":
        return priority ? (
          <Badge label={priority.label} tone={priority.tone} />
        ) : null;
      case "types":
        return (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {typesText(view, lookups)}
          </Text>
        );
      case "area":
        return (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {areaText(view, lookups)}
          </Text>
        );
      case "summary":
        return (
          <Text variant="body" numberOfLines={1}>
            {incident.summary ?? ""}
          </Text>
        );
      case "started":
        return (
          <Text variant="caption" color="textMuted">
            {formatShortTime(incident.started)}
          </Text>
        );
      case "modified":
        return (
          <Text variant="caption" color="textMuted">
            {formatShortTime(incident.lastModified)}
          </Text>
        );
      case "people":
        return (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {peopleText(view)}
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
