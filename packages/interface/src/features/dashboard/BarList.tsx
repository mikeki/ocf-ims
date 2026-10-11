// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { View } from "react-native";
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
// colour from `color`. The bar is `chart.barThickness` tall, centred in a
// `spacing.xl` row; the label column wraps and never truncates.

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
  testID?: string;
}

export function BarList(props: BarListProps) {
  const {
    items,
    color = "primary",
    sorted = false,
    limit,
    caption,
    testID,
  } = props;
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return (
      <Text variant="body" color="textMuted" testID={testID}>
        No incidents yet
      </Text>
    );
  }

  const ordered = sorted ? [...items].sort((a, b) => b.count - a.count) : items;
  const visible = limit && !expanded ? ordered.slice(0, limit) : ordered;
  const hiddenCount = limit ? Math.max(0, ordered.length - limit) : 0;
  const max = Math.max(1, ...ordered.map((i) => i.count));
  const countColumnWidth = theme.spacing.xxl * 2;

  return (
    <View style={{ gap: theme.spacing.xs }} testID={testID}>
      {visible.map((item) => {
        const barColor = item.tone
          ? theme.tones[item.tone].ink
          : theme.colors[color];
        return (
          <View
            key={item.key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing.sm,
            }}
          >
            <Text variant="label" style={{ flexBasis: "34%", flexShrink: 1 }}>
              {item.label}
            </Text>
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.sm,
              }}
            >
              <View
                style={{
                  flex: 1,
                  height: theme.spacing.xl,
                  justifyContent: "center",
                }}
              >
                <View
                  testID={testID ? `${testID}-bar-${item.key}` : undefined}
                  style={{
                    width: `${Math.max(2, (item.count / max) * 100)}%`,
                    height: chart.barThickness,
                    backgroundColor: barColor,
                    borderTopRightRadius: theme.radii.sm,
                    borderBottomRightRadius: theme.radii.sm,
                  }}
                />
              </View>
              <Text
                variant="caption"
                color="textMuted"
                style={{ minWidth: countColumnWidth, textAlign: "right" }}
              >
                {item.count}
              </Text>
            </View>
          </View>
        );
      })}
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
