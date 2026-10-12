// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { BarChart } from "react-native-gifted-charts";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { type ColorRoles, chart } from "@/design/tokens";

// `by_day` (docs/plans/09ab-dashboard-design.md § The forms): one column per
// day, the latest and busiest labelled above their own columns, the rest
// reachable by press into a single readout line above
// the chart (§ What to build 6; the library exposes no hover, so web is press
// only). The "Table" word is a hard cut to a
// date · count list, per every chart's own table (§ The forms).
//
// One gifted-charts `BarChart`: `barWidth` = `chart.columnWidth`, `height` =
// `chart.plotHeight`. The card is measured (`onLayout`) so each day gets an
// equal-width slot and its column is centred in it; the day-of-month under the
// baseline is the library's `label`, the short date above a column its
// `topLabelComponent`. No scroller, no animation.

export interface DayColumnsItem {
  date: string;
  count: number;
}

export interface DayColumnsProps {
  days: DayColumnsItem[];
  color?: keyof ColorRoles;
  testID?: string;
}

function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayOfMonth(date: string): string {
  return String(new Date(`${date}T00:00:00`).getDate());
}

export function DayColumns(props: DayColumnsProps) {
  const { days, color = "primary", testID } = props;
  const theme = useTheme();
  const [showTable, setShowTable] = useState(false);
  const [plotWidth, setPlotWidth] = useState(0);
  const [shownDate, setShownDate] = useState<string | undefined>(undefined);

  if (days.length === 0) {
    return (
      <Text variant="body" color="textMuted" testID={testID}>
        No incidents yet
      </Text>
    );
  }

  const latestDate = days.reduce(
    (a, d) => (d.date > a ? d.date : a),
    days[0]?.date ?? "",
  );
  const busiestDate = days.reduce(
    (a, d) =>
      d.count > (days.find((x) => x.date === a)?.count ?? -1) ? d.date : a,
    days[0]?.date ?? "",
  );
  const shown =
    days.find((d) => d.date === shownDate) ??
    days.find((d) => d.date === latestDate);
  const max = Math.max(1, ...days.map((d) => d.count));
  const chartHeight = chart.plotHeight;
  const columnWidth = chart.columnWidth;
  const slot = plotWidth / days.length;

  return (
    <View style={{ gap: theme.spacing.sm }} testID={testID}>
      <Text variant="caption" color="textMuted">
        {shown ? `${shortDate(shown.date)} · ${shown.count}` : " "}
      </Text>
      {showTable ? (
        <View style={{ gap: theme.spacing.xs }}>
          {days.map((d) => (
            <View
              key={d.date}
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Text variant="label">{shortDate(d.date)}</Text>
              <Text variant="caption" color="textMuted">
                {d.count}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <View
          style={{ paddingTop: theme.spacing.lg }}
          onLayout={(e) => setPlotWidth(e.nativeEvent.layout.width)}
        >
          {plotWidth > 0 ? (
            <BarChart
              data={days.map((d) => ({
                value: d.count,
                label: dayOfMonth(d.date),
                frontColor: theme.colors[color],
                topLabelComponent:
                  d.date === latestDate || d.date === busiestDate
                    ? () => (
                        <Text
                          variant="caption"
                          color="textMuted"
                          numberOfLines={1}
                          style={{ width: slot, textAlign: "center" }}
                        >
                          {shortDate(d.date)}
                        </Text>
                      )
                    : undefined,
              }))}
              onPress={(item: { value?: number }, index: number) => {
                const day = days[index];
                if (day && item) setShownDate(day.date);
              }}
              width={plotWidth}
              height={chartHeight}
              barWidth={columnWidth}
              spacing={Math.max(theme.spacing.xs, slot - columnWidth)}
              initialSpacing={Math.max(0, (slot - columnWidth) / 2)}
              endSpacing={Math.max(0, (slot - columnWidth) / 2)}
              maxValue={max}
              noOfSections={1}
              barBorderTopLeftRadius={theme.radii.sm}
              barBorderTopRightRadius={theme.radii.sm}
              xAxisThickness={StyleSheet.hairlineWidth}
              xAxisColor={theme.colors.border}
              xAxisLabelTextStyle={[
                theme.type.caption,
                { color: theme.colors.textMuted },
              ]}
              yAxisThickness={0}
              yAxisLabelWidth={0}
              hideYAxisText
              hideRules
              disableScroll
            />
          ) : null}
        </View>
      )}
      <TextButton
        label={showTable ? "Chart" : "Table"}
        onPress={() => setShowTable((v) => !v)}
      />
    </View>
  );
}
