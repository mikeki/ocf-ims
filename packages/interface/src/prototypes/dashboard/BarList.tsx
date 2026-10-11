// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import type { ColorRoles, Tone } from "@/design/tokens";

// One series of bars — every breakdown but `by_day` (docs/plans/09ab-dashboard-design.md
// § The forms): the bar is an addition to a table, never the only way to read
// a value, so every row still prints its label and count. `sorted` picks
// count-desc (a breakdown) over the given order (`by_role`'s ladder); `limit`
// folds the tail into an in-place "N more" (a hard cut, no animation);
// `showShare` adds Tables' own percentage column. A `tone` per item is
// priority's own colour language; everything else takes one colour from
// `color`.

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
  showShare?: boolean;
  /** The label on its own line above the bar, for a narrow column where a side-by-side label would truncate. */
  stacked?: boolean;
  caption?: string;
  testID?: string;
}

export function BarList(props: BarListProps) {
  const {
    items,
    color = "primary",
    sorted = false,
    limit,
    showShare = false,
    stacked = false,
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
  const total = ordered.reduce((sum, i) => sum + i.count, 0);
  const countColumnWidth = theme.spacing.xxl * 2;
  // The track keeps its row height (rhythm between rows); the bar itself is
  // thinner and centred in it, so a row has air above and below the mark.
  const trackHeight = theme.spacing.xl;
  const barHeight = theme.spacing.md;

  return (
    <View style={{ gap: theme.spacing.xs }} testID={testID}>
      {visible.map((item) => {
        const barColor = item.tone
          ? theme.tones[item.tone].ink
          : theme.colors[color];
        const share = total > 0 ? Math.round((item.count / total) * 100) : 0;
        const track = (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing.sm,
              flex: stacked ? undefined : 1,
            }}
          >
            <View
              style={{
                flex: 1,
                height: trackHeight,
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: `${Math.max(2, (item.count / max) * 100)}%`,
                  height: barHeight,
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
            {showShare ? (
              <Text
                variant="caption"
                color="textMuted"
                style={{ minWidth: countColumnWidth, textAlign: "right" }}
              >
                {`${share}%`}
              </Text>
            ) : null}
          </View>
        );
        if (stacked) {
          return (
            <View key={item.key} style={{ gap: theme.spacing.xs }}>
              <Text variant="label" numberOfLines={1}>
                {item.label}
              </Text>
              {track}
            </View>
          );
        }
        return (
          <View
            key={item.key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing.sm,
            }}
          >
            <Text
              variant="label"
              numberOfLines={1}
              style={{ flexBasis: "34%", flexShrink: 1 }}
            >
              {item.label}
            </Text>
            {track}
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
