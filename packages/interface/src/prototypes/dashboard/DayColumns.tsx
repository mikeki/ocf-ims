// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import type { ColorRoles } from "@/design/tokens";

// `by_day` (docs/plans/09ab-dashboard-design.md § The forms): one column per
// day, the latest and busiest labelled above their own columns, the rest
// reachable by press (native) / hover (web) into a single readout line above
// the chart (§ What to build 6). The "Table" word is a hard cut to a
// date · count list, per every chart's own table (§ The forms).
//
// Each day gets an equal-width slot so 8+ days never crowd a wide card, but
// the column drawn inside it is capped (`COLUMN_WIDTH`) and centred, so it
// reads as a thin mark rather than a saturated block touching its neighbour.

export interface DayColumnsItem {
  date: string;
  count: number;
}

export interface DayColumnsProps {
  days: DayColumnsItem[];
  color?: keyof ColorRoles;
  testID?: string;
}

/** The chart's own height, a multiple of a spacing token rather than a literal. */
const CHART_HEIGHT_STEPS = 8;

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
  const chartHeight = theme.spacing.xl * CHART_HEIGHT_STEPS;
  const columnWidth = theme.spacing.xl;

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
        <View style={{ gap: theme.spacing.xs }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: theme.spacing.xs,
              height: chartHeight + theme.spacing.lg,
            }}
          >
            {days.map((d) => {
              const isLatest = d.date === latestDate;
              const isBusiest = d.date === busiestDate;
              const height = Math.max(
                theme.spacing.xs,
                Math.round((d.count / max) * chartHeight),
              );
              return (
                <Pressable
                  key={d.date}
                  accessibilityRole="button"
                  accessibilityLabel={`${shortDate(d.date)}, ${d.count} incidents`}
                  onPress={() => setShownDate(d.date)}
                  onHoverIn={() => setShownDate(d.date)}
                  style={{ flex: 1, alignItems: "center" }}
                >
                  {({ pressed }) => (
                    <PressFeedback
                      pressed={pressed}
                      style={{ alignItems: "center" }}
                    >
                      <Text
                        variant="caption"
                        color="textMuted"
                        numberOfLines={1}
                        style={{ height: theme.spacing.lg }}
                      >
                        {isLatest || isBusiest ? shortDate(d.date) : ""}
                      </Text>
                      <View
                        style={{
                          width: columnWidth,
                          height,
                          backgroundColor: theme.colors[color],
                          borderTopLeftRadius: theme.radii.sm,
                          borderTopRightRadius: theme.radii.sm,
                        }}
                      />
                    </PressFeedback>
                  )}
                </Pressable>
              );
            })}
          </View>
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: theme.colors.border,
            }}
          />
          <View style={{ flexDirection: "row", gap: theme.spacing.xs }}>
            {days.map((d) => (
              <View key={d.date} style={{ flex: 1, alignItems: "center" }}>
                <Text variant="caption" color="textMuted">
                  {dayOfMonth(d.date)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
      <TextButton
        label={showTable ? "Chart" : "Table"}
        onPress={() => setShowTable((v) => !v)}
      />
    </View>
  );
}
