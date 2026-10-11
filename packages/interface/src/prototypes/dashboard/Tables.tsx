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

// Tables (docs/plans/09ab-dashboard-design.md § The prototype round):
// "numbers first" — no cards, hairline-separated sections reading like the
// dispatch table itself. The KPI row is compact, per day is a thin strip
// under it, and every breakdown is a label · count · share table with its
// own small inline bar, left of the Open follow-ups table.

export function Tables(props: DashboardPaneProps) {
  const { metrics, changedKeys, onOpenFollowUp } = props;
  const theme = useTheme();

  return (
    <ScrollView
      contentContainerStyle={{
        padding: theme.spacing.lg,
        gap: theme.spacing.sm,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <StatTile
          testID="tables-total"
          label="Total"
          value={String(metrics.total)}
          changed={changedKeys.has("total")}
        />
        <StatTile
          testID="tables-open"
          label="Open"
          value={String(metrics.open)}
          changed={changedKeys.has("open")}
        />
        <StatTile
          testID="tables-closed"
          label="Closed"
          value={String(metrics.closed)}
          changed={changedKeys.has("closed")}
        />
        <StatTile
          testID="tables-avg"
          label="Avg. time to close"
          value={avgCloseValue(metrics.avgTimeToCloseSeconds)}
          caption={avgCloseCaption(
            metrics.avgTimeToCloseSeconds,
            metrics.closedCount,
          )}
          changed={changedKeys.has("avg")}
        />
      </View>

      <Section title="Per day" changed={changedKeys.has("day")}>
        <DayColumns
          testID="tables-day"
          days={metrics.byDay.map((d) => ({
            date: d.date,
            count: toCount(d.count),
          }))}
        />
      </Section>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.xl,
        }}
      >
        <View
          style={{
            flexGrow: 2,
            flexBasis: theme.spacing.xl * 20,
            gap: theme.spacing.sm,
          }}
        >
          <Section title="Priority" changed={changedKeys.has("priority")}>
            <BarList
              testID="tables-priority"
              showShare
              items={metrics.byPriority.map((p) => ({
                key: p.key,
                label: p.label,
                count: toCount(p.count),
                tone: priorityTone(p.key),
              }))}
            />
          </Section>
          <Section title="Category" changed={changedKeys.has("category")}>
            <BarList
              testID="tables-category"
              sorted
              showShare
              items={metrics.byCategory.map((c) => ({
                key: c.key,
                label: c.label,
                count: toCount(c.count),
              }))}
            />
          </Section>
          <Section title="Type" changed={changedKeys.has("type")}>
            <BarList
              testID="tables-type"
              sorted
              showShare
              limit={10}
              items={metrics.byType.map((t) => ({
                key: t.key,
                label: t.label,
                count: toCount(t.count),
              }))}
            />
          </Section>
          <Section title="Area" changed={changedKeys.has("area")}>
            <BarList
              testID="tables-area"
              sorted
              showShare
              limit={10}
              caption="Top 10 areas"
              items={metrics.byArea.map((a) => ({
                key: a.key,
                label: a.label,
                count: toCount(a.count),
              }))}
            />
          </Section>
          <Section title="Roles" changed={changedKeys.has("roles")}>
            <BarList
              testID="tables-roles"
              showShare
              caption="People, not incidents"
              items={metrics.byRole.map((r) => ({
                key: r.key,
                label: r.label,
                count: toCount(r.count),
              }))}
            />
          </Section>
        </View>

        <View style={{ flexGrow: 1, flexBasis: theme.spacing.xl * 14 }}>
          <Section
            title="Open follow-ups"
            changed={changedKeys.has("followUps")}
          >
            <FollowUps
              testID="tables-followups"
              items={metrics.openFollowUps}
              onOpen={onOpenFollowUp}
            />
          </Section>
        </View>
      </View>
    </ScrollView>
  );
}

function Section(props: {
  title: string;
  changed: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingVertical: theme.spacing.md,
        gap: theme.spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
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
