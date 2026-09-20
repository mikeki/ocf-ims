// SPDX-License-Identifier: Apache-2.0

import { View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// A KPI tile (docs/plans/09ab-dashboard-design.md § The forms): the value in
// proportional figures — `title`'s own type step carries no tabular-nums, so
// this reads it as-is rather than `figure`'s tabular one. The changed mark is
// a hard cut (§ What changed): a small `info` dot beside the label, no
// animation, gone on the next successful refresh or after 60 s
// (useMetrics.ts).

export interface StatTileProps {
  label: string;
  /** The formatted value; "—" when unset. */
  value: string;
  caption?: string;
  changed?: boolean;
  testID?: string;
}

export function StatTile(props: StatTileProps) {
  const { label, value, caption, changed = false, testID } = props;
  const theme = useTheme();
  return (
    <View
      style={{ flexGrow: 1, flexBasis: 0, gap: theme.spacing.xs }}
      testID={testID}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.xs,
        }}
      >
        <Text variant="label" color="textMuted">
          {label}
        </Text>
        {changed ? (
          <ChangedDot
            label={label}
            testID={testID ? `${testID}-changed` : undefined}
          />
        ) : null}
      </View>
      <Text variant="title">{value}</Text>
      {caption ? (
        <Text variant="caption" color="textMuted">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/** The changed mark (§ What changed): a small `info` dot, no animation. Shared by every card title. */
export function ChangedDot(props: { label: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={`${props.label} changed`}
      testID={props.testID}
      style={{
        width: theme.spacing.sm,
        height: theme.spacing.sm,
        marginLeft: theme.spacing.xs,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.tones.info.ink,
      }}
    />
  );
}
