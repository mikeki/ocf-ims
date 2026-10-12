// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { BarList } from "@/features/dashboard/BarList";
import { DayColumns } from "@/features/dashboard/DayColumns";
import { FollowUps } from "@/features/dashboard/FollowUps";
import {
  avgCloseCaption,
  avgCloseValue,
  priorityTone,
  toCount,
} from "@/features/dashboard/format";
import { ChangedDot, StatTile } from "@/features/dashboard/StatTile";
import { Toolbar } from "@/features/dashboard/Toolbar";
import { useAutoRefresh } from "@/features/dashboard/useAutoRefresh";
import { type ChangedKey, useMetrics } from "@/features/dashboard/useMetrics";
import { HelpSheet } from "@/features/dispatch/HelpSheet";
import { EmptyState } from "@/features/shell/EmptyState";
import { LoadingState } from "@/features/shell/LoadingState";
import { useLayoutMode } from "@/features/shell/layoutMode";
import { useWebKeydown } from "@/lib/useWebKeydown";

// The dashboard (docs/plans/09ab-dashboard-design.md § The pick, criteria
// 8-13), promoted from the Board surface: the toolbar, the KPI row, then a
// two-column grid of same-chrome cards (one column below 1024). Gated by the
// server: a caller without writeIncidents is answered PermissionDenied, which
// reads as "Not found", never a 403.

/** The dashboard's keys (criterion 12), for the shared `HelpSheet`. */
export const DASHBOARD_HELP_ROWS: [string, string][] = [
  ["r", "Refresh the numbers"],
  ["?", "This sheet"],
];

export interface DashboardScreenProps {
  eventId: number;
  /** Opens the incident table with the incident in the drawer. */
  onOpenFollowUp: (incidentNumber: number) => void;
}

export function DashboardScreen(props: DashboardScreenProps) {
  // Keyed by event: switching events is a fresh read, not a "refresh" —
  // without this the outgoing event's numbers would be diffed against the
  // incoming one's and half the page would be marked changed.
  return <DashboardBody key={props.eventId} {...props} />;
}

function DashboardBody(props: DashboardScreenProps) {
  const { eventId, onOpenFollowUp } = props;
  const auto = useAutoRefresh();
  const {
    metrics,
    isLoading,
    isRefreshing,
    error,
    lastError,
    changedKeys,
    refresh,
  } = useMetrics(eventId, auto.intervalMs);
  const [help, setHelp] = useState(false);
  useDashboardKeys({ refresh, help, setHelp });

  if (!metrics) {
    if (error === undefined || isLoading || isRefreshing) {
      return <LoadingState />;
    }
    if (error.kind === "forbidden" || error.kind === "notFound") {
      return <EmptyState title="Not found" />;
    }
    return (
      <EmptyState
        title="Couldn't load"
        message={error.message}
        action={{ label: "Retry", onPress: refresh }}
      />
    );
  }

  const generatedAtMs = metrics.generatedAt
    ? Number(metrics.generatedAt.seconds) * 1000
    : undefined;

  return (
    <View style={{ flex: 1 }}>
      <Toolbar
        testID="dashboard-toolbar"
        generatedAtMs={generatedAtMs}
        isRefreshing={isRefreshing}
        lastError={lastError}
        onRefresh={refresh}
        preference={auto.preference}
        onPreferenceChange={auto.setPreference}
      />
      <Cards
        metrics={metrics}
        changed={changedKeys}
        onOpenFollowUp={onOpenFollowUp}
      />
      <HelpSheet
        open={help}
        onClose={() => setHelp(false)}
        rows={DASHBOARD_HELP_ROWS}
      />
    </View>
  );
}

/** `r` refreshes, `?` toggles help, Esc closes it; web only, focus-gated, never while an input has focus. */
function useDashboardKeys(deps: {
  refresh: () => void;
  help: boolean;
  setHelp: (on: boolean) => void;
}) {
  useWebKeydown((e) => {
    if (e.key === "r") {
      deps.refresh();
    } else if (e.key === "?") {
      deps.setHelp(!deps.help);
    } else if (e.key === "Escape" && deps.help) {
      deps.setHelp(false);
    }
  });
}

function Cards(props: {
  metrics: NonNullable<ReturnType<typeof useMetrics>["metrics"]>;
  changed: ReadonlySet<ChangedKey>;
  onOpenFollowUp: (incidentNumber: number) => void;
}) {
  const { metrics, changed, onOpenFollowUp } = props;
  const theme = useTheme();
  const narrow = useLayoutMode() !== "wide";

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
          narrow={narrow}
          testID="dashboard-total"
          label="Total"
          value={String(metrics.total)}
          changed={changed.has("total")}
        />
        <StatTile
          narrow={narrow}
          testID="dashboard-open"
          label="Open"
          value={String(metrics.open)}
          changed={changed.has("open")}
        />
        <StatTile
          narrow={narrow}
          testID="dashboard-closed"
          label="Closed"
          value={String(metrics.closed)}
          changed={changed.has("closed")}
        />
        <StatTile
          narrow={narrow}
          testID="dashboard-avg"
          label="Avg. time to close"
          value={avgCloseValue(metrics.avgTimeToCloseSeconds)}
          caption={avgCloseCaption(
            metrics.avgTimeToCloseSeconds,
            metrics.closedCount,
          )}
          changed={changed.has("avg")}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.lg,
        }}
      >
        <Card
          narrow={narrow}
          title="Priority"
          changed={changed.has("priority")}
        >
          <BarList
            testID="dashboard-priority"
            items={metrics.byPriority.map((p) => ({
              key: p.key,
              label: p.label,
              count: toCount(p.count),
              tone: priorityTone(p.key),
            }))}
          />
        </Card>
        <Card
          narrow={narrow}
          title="Category"
          changed={changed.has("category")}
        >
          <BarList
            testID="dashboard-category"
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
        <Card narrow={narrow} title="Type" changed={changed.has("type")}>
          <BarList
            testID="dashboard-type"
            sorted
            limit={10}
            items={metrics.byType.map((t) => ({
              key: t.key,
              label: t.label,
              count: toCount(t.count),
            }))}
          />
        </Card>
        <Card narrow={narrow} title="Area" changed={changed.has("area")}>
          <BarList
            testID="dashboard-area"
            sorted
            limit={10}
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
        <Card narrow={narrow} title="Per day" changed={changed.has("day")}>
          <DayColumns
            testID="dashboard-day"
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
        <Card narrow={narrow} title="Roles" changed={changed.has("roles")}>
          <BarList
            testID="dashboard-roles"
            caption="People, not incidents"
            emptyLabel="No roles yet"
            items={metrics.byRole.map((r) => ({
              key: r.key,
              label: r.label,
              count: toCount(r.count),
            }))}
          />
        </Card>
        <Card
          narrow={narrow}
          title="Open follow-ups"
          changed={changed.has("followUps")}
        >
          <FollowUps
            testID="dashboard-followups"
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

function Card(props: {
  title: string;
  changed: boolean;
  narrow: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        // One column below 1024: the card takes the whole row.
        flexBasis: props.narrow
          ? "100%"
          : theme.spacing.xl * CARD_MIN_WIDTH_STEPS,
        minWidth: props.narrow
          ? 0
          : theme.spacing.xl * (CARD_MIN_WIDTH_STEPS - 2),
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
