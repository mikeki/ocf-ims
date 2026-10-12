// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { View } from "react-native";
import { BarChart } from "react-native-gifted-charts";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { type ColorRoles, chart, type Tone } from "@/design/tokens";

// One series of bars — every breakdown but `by_day` (docs/plans/09ab-dashboard-design.md
// § The forms): the bar is an addition to a table, never the only way to read
// a value, so every row still prints its label and count. `sorted` picks
// count-desc (a breakdown) over the given order (`by_role`'s ladder); `limit`
// folds the tail into an in-place "N more" (a hard cut, no animation). A
// `tone` per item is priority's own colour language; everything else takes one
// colour from `color`. The bars are one gifted-charts horizontal `BarChart`
// (`barWidth` = `chart.barThickness`, one `spacing.xl` slot per row). The
// library's horizontal mode rotates its labels into a barWidth-wide strip, so
// the label and count columns stay ours, row-aligned beside the chart: the
// label is one line at the bar pitch (its full text on the accessibility
// label; a wrapped row would drift off its bar), the count is plain text.

export interface BarListItem {
  key: string;
  label: string;
  count: number;
  /** Priority's own tone; every other list leaves this unset and uses `color`. */
  tone?: Tone;
}

export interface BarListProps {
  items: BarListItem[];
  /** The one accent colour for a list without per-item tones. */
  color?: keyof ColorRoles;
  /** Count-desc, not the given (ladder) order. */
  sorted?: boolean;
  /** Top N, with the rest behind an "N more" `TextButton`. */
  limit?: number;
  caption?: string;
  /** The empty line; Roles counts people, not incidents. */
  emptyLabel?: string;
  testID?: string;
}

export function BarList(props: BarListProps) {
  const {
    items,
    color = "primary",
    sorted = false,
    limit,
    caption: callerCaption,
    emptyLabel = "No incidents yet",
    testID,
  } = props;
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [plotWidth, setPlotWidth] = useState(0);

  if (items.length === 0) {
    return (
      <Text variant="body" color="textMuted" testID={testID}>
        {emptyLabel}
      </Text>
    );
  }

  const ordered = sorted ? [...items].sort((a, b) => b.count - a.count) : items;
  const visible = limit && !expanded ? ordered.slice(0, limit) : ordered;
  const hiddenCount = limit ? Math.max(0, ordered.length - limit) : 0;
  // A limited list names its cut while collapsed ("Top 10") and drops it once
  // expanded (or when nothing is cut); a caller's own caption wins.
  const caption =
    callerCaption ??
    (limit && !expanded && hiddenCount > 0 ? `Top ${limit}` : undefined);
  const max = Math.max(1, ...ordered.map((i) => i.count));
  const rowHeight = theme.spacing.xl;
  const labelWidth = "34%";

  return (
    <View style={{ gap: theme.spacing.xs }} testID={testID}>
      <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
        <View style={{ flexBasis: labelWidth, flexShrink: 1 }}>
          {visible.map((item) => (
            <View
              key={item.key}
              style={{ height: rowHeight, justifyContent: "center" }}
            >
              {/* One line, fixed to the bar pitch: the chart draws every bar
                  at `rowHeight`, so a wrapping label would drift off its
                  bar. The full label stays readable to assistive tech. */}
              <Text
                variant="label"
                numberOfLines={1}
                accessibilityLabel={item.label}
              >
                {item.label}
              </Text>
            </View>
          ))}
        </View>
        <View
          style={{ flex: 1, height: rowHeight * visible.length }}
          onLayout={(e) => setPlotWidth(e.nativeEvent.layout.width)}
        >
          {plotWidth > 0 ? (
            <BarChart
              horizontal
              data={visible.map((item) => ({
                value: item.count,
                frontColor: item.tone
                  ? theme.tones[item.tone].ink
                  : theme.colors[color],
              }))}
              width={plotWidth}
              height={rowHeight * visible.length}
              barWidth={chart.barThickness}
              spacing={rowHeight - chart.barThickness}
              initialSpacing={(rowHeight - chart.barThickness) / 2}
              endSpacing={(rowHeight - chart.barThickness) / 2}
              maxValue={max}
              noOfSections={1}
              barBorderTopRightRadius={theme.radii.sm}
              barBorderBottomRightRadius={theme.radii.sm}
              hideRules
              hideYAxisText
              yAxisThickness={0}
              xAxisThickness={0}
              disableScroll
              disablePress
            />
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {visible.map((item) => (
            <View
              key={item.key}
              style={{ height: rowHeight, justifyContent: "center" }}
            >
              <Text
                variant="caption"
                color="textMuted"
                style={{ minWidth: theme.spacing.xxl, textAlign: "right" }}
              >
                {item.count}
              </Text>
            </View>
          ))}
        </View>
      </View>
      {hiddenCount > 0 && !expanded ? (
        <TextButton
          label={`${hiddenCount} more`}
          onPress={() => setExpanded(true)}
        />
      ) : null}
      {caption ? (
        <Text variant="caption" color="textMuted">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
