// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { BarList } from "@/prototypes/dashboard/BarList";
import { DayColumns } from "@/prototypes/dashboard/DayColumns";
import { FollowUps } from "@/prototypes/dashboard/FollowUps";
import {
  avgCloseValue,
  priorityTone,
  toCount,
} from "@/prototypes/dashboard/format";
import { ChangedDot } from "@/prototypes/dashboard/StatTile";
import type { DashboardPaneProps } from "@/prototypes/dashboard/types";

// Shift (docs/plans/09ab-dashboard-design.md § The prototype round): "what
// needs action first" — Open is the hero figure, Open follow-ups sits beside
// it (the only thing on the page someone acts on), per day spans the width,
// and the breakdowns fall back to a narrower, shorter, top-five grid with
// Roles last.

/** `title`'s own step, scaled up rather than a new font-size literal (≥ 48 px). */
const HERO_SCALE = 2.25;

export function Shift(props: DashboardPaneProps) {
  const { metrics, changedKeys, onOpenFollowUp } = props;
  const theme = useTheme();
  const heroStyle = {
    ...theme.type.title,
    fontSize: (theme.type.title.fontSize ?? 0) * HERO_SCALE,
    lineHeight: (theme.type.title.lineHeight ?? 0) * HERO_SCALE,
  };

  return (
    <ScrollView
      contentContainerStyle={{
        padding: theme.spacing.xl,
        gap: theme.spacing.xl,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.xl,
        }}
      >
        <View
          style={{
            flexGrow: 1,
            flexBasis: theme.spacing.xl * 14,
            gap: theme.spacing.xs,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing.sm,
            }}
          >
            <Text variant="label" color="textMuted">
              Open
            </Text>
            {changedKeys.has("open") ? <ChangedDot label="Open" /> : null}
          </View>
          <Text style={heroStyle} testID="shift-open">
            {String(metrics.open)}
          </Text>
          <Text variant="body" color="textMuted">
            {`of ${metrics.total} · ${metrics.closed} closed · avg. close ${avgCloseValue(metrics.avgTimeToCloseSeconds)}`}
          </Text>
        </View>
        <View style={{ flexGrow: 2, flexBasis: theme.spacing.xl * 16 }}>
          <SectionTitle
            title="Open follow-ups"
            changed={changedKeys.has("followUps")}
          />
          <FollowUps
            testID="shift-followups"
            items={metrics.openFollowUps}
            onOpen={onOpenFollowUp}
          />
        </View>
      </View>

      <View>
        <SectionTitle title="Per day" changed={changedKeys.has("day")} />
        <DayColumns
          testID="shift-day"
          days={metrics.byDay.map((d) => ({
            date: d.date,
            count: toCount(d.count),
          }))}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.lg,
        }}
      >
        <View
          style={{
            flexGrow: 1,
            flexBasis: theme.spacing.xl * 10,
            maxWidth: theme.spacing.xl * 14,
          }}
        >
          <SectionTitle
            title="Priority"
            changed={changedKeys.has("priority")}
          />
          <BarList
            testID="shift-priority"
            stacked
            limit={5}
            items={metrics.byPriority.map((p) => ({
              key: p.key,
              label: p.label,
              count: toCount(p.count),
              tone: priorityTone(p.key),
            }))}
          />
        </View>
        <View
          style={{
            flexGrow: 1,
            flexBasis: theme.spacing.xl * 10,
            maxWidth: theme.spacing.xl * 14,
          }}
        >
          <SectionTitle
            title="Category"
            changed={changedKeys.has("category")}
          />
          <BarList
            testID="shift-category"
            stacked
            sorted
            limit={5}
            items={metrics.byCategory.map((c) => ({
              key: c.key,
              label: c.label,
              count: toCount(c.count),
            }))}
          />
        </View>
        <View
          style={{
            flexGrow: 1,
            flexBasis: theme.spacing.xl * 10,
            maxWidth: theme.spacing.xl * 14,
          }}
        >
          <SectionTitle title="Type" changed={changedKeys.has("type")} />
          <BarList
            testID="shift-type"
            stacked
            sorted
            limit={5}
            items={metrics.byType.map((t) => ({
              key: t.key,
              label: t.label,
              count: toCount(t.count),
            }))}
          />
        </View>
        <View
          style={{
            flexGrow: 1,
            flexBasis: theme.spacing.xl * 10,
            maxWidth: theme.spacing.xl * 14,
          }}
        >
          <SectionTitle title="Area" changed={changedKeys.has("area")} />
          <BarList
            testID="shift-area"
            stacked
            sorted
            limit={5}
            items={metrics.byArea.map((a) => ({
              key: a.key,
              label: a.label,
              count: toCount(a.count),
            }))}
          />
        </View>
        <View
          style={{
            flexGrow: 1,
            flexBasis: theme.spacing.xl * 10,
            maxWidth: theme.spacing.xl * 14,
          }}
        >
          <SectionTitle title="Roles" changed={changedKeys.has("roles")} />
          <BarList
            testID="shift-roles"
            stacked
            caption="People, not incidents"
            items={metrics.byRole.map((r) => ({
              key: r.key,
              label: r.label,
              count: toCount(r.count),
            }))}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function SectionTitle(props: { title: string; changed: boolean }): ReactNode {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.xs,
        marginBottom: theme.spacing.sm,
      }}
    >
      <Text variant="heading">{props.title}</Text>
      {props.changed ? <ChangedDot label={props.title} /> : null}
    </View>
  );
}
