// SPDX-License-Identifier: Apache-2.0

import { memo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";
import { formatShortTime, personLabel } from "@/lib/format";
import type { Column } from "@/prototypes/reports/reportColumns";
import type { Row } from "@/prototypes/reports/reportQuery";

// The one report row, a retyped copy of src/features/dispatch/IncidentRow.tsx:
// one line, a fixed height (the list windows on it), Report# in the ledger
// column. No state / priority colour language — a report carries neither.

/** Row height: one body line, its vertical padding and the rule. Fixed, so
 * the list can window on it. */
export function rowHeight(lineHeight: number, pad: number): number {
  return lineHeight + 2 * pad + StyleSheet.hairlineWidth;
}

export interface ReportRowProps {
  view: Row;
  columns: Column[];
  selected: boolean;
  height: number;
  onPress: (number: number) => void;
}

export const ReportRow = memo(function ReportRow(props: ReportRowProps) {
  const { view, columns, selected, height, onPress } = props;
  const report = view.report;
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const linked = report.incident !== undefined && report.incident > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`R-${report.number} ${report.summary ?? ""}`}
      onPress={() => onPress(report.number)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      pressRetentionOffset={pressRetentionOffset}
      testID={`report-row-${report.number}`}
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
            R-{report.number}
          </Text>
        );
      case "incident":
        return (
          <Text variant="figure" color={linked ? "text" : "textMuted"}>
            {linked ? report.incident : "—"}
          </Text>
        );
      case "summary":
        return (
          <Text variant="body" numberOfLines={1}>
            {report.summary ?? ""}
          </Text>
        );
      case "created":
        return (
          <Text variant="caption" color="textMuted">
            {formatShortTime(report.created)}
          </Text>
        );
      case "createdBy":
        return (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {personLabel(report.createdBy)}
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
});
