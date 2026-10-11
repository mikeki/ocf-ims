// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { BarList } from "@/prototypes/dashboard/BarList";
import { DayColumns } from "@/prototypes/dashboard/DayColumns";
import { FollowUps } from "@/prototypes/dashboard/FollowUps";
import {
  avgCloseCaption,
  avgCloseValue,
  priorityTone,
  toCount,
} from "@/prototypes/dashboard/format";
import { ChangedDot, StatTile } from "@/prototypes/dashboard/StatTile";
import type { DashboardPaneProps } from "@/prototypes/dashboard/types";

// Board (docs/plans/09ab-dashboard-design.md § The prototype round): the KPI
// row, then a two-column grid of same-chrome cards — "everything at once",
// templ's own grid done properly. The order of attention isn't a claim this
// variant makes; every card weighs the same.

export function Board(props: DashboardPaneProps) {
  const { metrics, changedKeys, onOpenFollowUp } = props;
  const theme = useTheme();

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
        <StatTile
          testID="board-total"
          label="Total"
          value={String(metrics.total)}
          changed={changedKeys.has("total")}
        />
        <StatTile
          testID="board-open"
          label="Open"
          value={String(metrics.open)}
          changed={changedKeys.has("open")}
        />
        <StatTile
          testID="board-closed"
          label="Closed"
          value={String(metrics.closed)}
          changed={changedKeys.has("closed")}
        />
        <StatTile
          testID="board-avg"
          label="Avg. time to close"
          value={avgCloseValue(metrics.avgTimeToCloseSeconds)}
          caption={avgCloseCaption(
            metrics.avgTimeToCloseSeconds,
            metrics.closedCount,
          )}
          changed={changedKeys.has("avg")}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.lg,
        }}
      >
        <Card title="Priority" changed={changedKeys.has("priority")}>
          <BarList
            testID="board-priority"
            items={metrics.byPriority.map((p) => ({
              key: p.key,
              label: p.label,
              count: toCount(p.count),
              tone: priorityTone(p.key),
            }))}
          />
        </Card>
        <Card title="Category" changed={changedKeys.has("category")}>
          <BarList
            testID="board-category"
            sorted
            items={metrics.byCategory.map((c) => ({
              key: c.key,
              label: c.label,
              count: toCount(c.count),
            }))}
          />
        </Card>
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.lg,
        }}
      >
        <Card title="Type" changed={changedKeys.has("type")}>
          <BarList
            testID="board-type"
            sorted
            limit={10}
            items={metrics.byType.map((t) => ({
              key: t.key,
              label: t.label,
              count: toCount(t.count),
            }))}
          />
        </Card>
        <Card title="Area" changed={changedKeys.has("area")}>
          <BarList
            testID="board-area"
            sorted
            limit={10}
            caption="Top 10 areas"
            items={metrics.byArea.map((a) => ({
              key: a.key,
              label: a.label,
              count: toCount(a.count),
            }))}
          />
        </Card>
      </View>

      {/* A row, not a bare child of the (column-direction) ScrollView: `Card`'s
          flexBasis/flexGrow are meant for a row's main axis (width) — as a
          direct column child they'd size the card's HEIGHT instead, leaving
          empty space below a chart shorter than that basis. */}
      <View style={{ flexDirection: "row" }}>
        <Card title="Per day" changed={changedKeys.has("day")}>
          <DayColumns
            testID="board-day"
            days={metrics.byDay.map((d) => ({
              date: d.date,
              count: toCount(d.count),
            }))}
          />
        </Card>
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.lg,
        }}
      >
        <Card title="Roles" changed={changedKeys.has("roles")}>
          <BarList
            testID="board-roles"
            caption="People, not incidents"
            items={metrics.byRole.map((r) => ({
              key: r.key,
              label: r.label,
              count: toCount(r.count),
            }))}
          />
        </Card>
        <Card title="Open follow-ups" changed={changedKeys.has("followUps")}>
          <FollowUps
            testID="board-followups"
            items={metrics.openFollowUps}
            onOpen={onOpenFollowUp}
          />
        </Card>
      </View>
    </ScrollView>
  );
}

/** A card's minimum width, a multiple of a spacing token rather than a literal. */
const CARD_MIN_WIDTH_STEPS = 16;

function Card(props: { title: string; changed: boolean; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: theme.spacing.xl * CARD_MIN_WIDTH_STEPS,
        minWidth: theme.spacing.xl * (CARD_MIN_WIDTH_STEPS - 2),
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.xs,
        }}
      >
        <Text variant="heading">{props.title}</Text>
        {props.changed ? <ChangedDot label={props.title} /> : null}
      </View>
      {props.children}
    </View>
  );
}
