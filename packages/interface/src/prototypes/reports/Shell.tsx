// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { touchTarget } from "@/design/tokens";
import { useAlerts } from "@/features/alerts/hooks";
import { useEventAccess, useEventName } from "@/features/events/hooks";
import { useLiveEvent } from "@/features/live/useLiveEvent";
import { useSession } from "@/session/provider";

// The wide-window shell for the 3c.3 round, a retyped copy of
// src/features/shell/Shell.tsx (top-bar mode only — 09x's pick): the same
// top bar, with **Reports** — active, beside Incidents and Alerts (09x
// criterion 2 left this item to this slice) — and **New report** in the
// action slot in place of "New incident", shown only when the viewer has
// `writeReports` (§ Gating). `useEventAccess` / `useEventName` are the real
// app's ListEvents-backed hooks; the round's fake seeds one event (`EVENT`,
// data.ts) so they resolve the same way.

export interface ShellProps {
  eventId: number;
  onNewReport: () => void;
  children: ReactNode;
}

export function Shell(props: ShellProps) {
  const { eventId, onNewReport, children } = props;
  const theme = useTheme();
  const { state, signOut } = useSession();
  const eventName = useEventName(eventId) || `Event ${eventId}`;
  const access = useEventAccess(eventId);
  const alerts = useAlerts();
  const live = useLiveEvent(eventId);
  const unread = Number(alerts.data?.unread ?? 0);
  const handle = state.status === "signedIn" ? state.auth.user : "";

  const newReport = access.writeReports ? (
    <Button label="New report" variant="secondary" onPress={onNewReport} />
  ) : null;

  const stream = live ? null : (
    <Text
      variant="label"
      color="textMuted"
      accessibilityLiveRegion="polite"
      testID="report-stream-state"
    >
      Reconnecting…
    </Text>
  );

  return (
    <View style={styles.fill}>
      <View
        style={[
          styles.row,
          styles.topbar,
          theme.elevation[1],
          {
            paddingHorizontal: theme.spacing.lg,
            gap: theme.spacing.lg,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <Text variant="heading">{eventName}</Text>
        <View style={[styles.row, { gap: theme.spacing.xs }]}>
          <NavItem label="Incidents" />
          <NavItem label="Reports" active />
          <NavItem label="Alerts" count={unread} />
        </View>
        <View style={styles.spacer} />
        {stream}
        {newReport}
        <View style={[styles.row, { gap: theme.spacing.sm }]}>
          <Text variant="label" color="textMuted" numberOfLines={1}>
            {handle}
          </Text>
          <TextButton
            label="Sign out"
            onPress={() => {
              void signOut();
            }}
          />
        </View>
      </View>
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

function NavItem(props: { label: string; count?: number; active?: boolean }) {
  const { label, count, active = false } = props;
  const theme = useTheme();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={count ? `${label}, ${count} unread` : label}
      testID={`shell-nav-${label.toLowerCase()}`}
      style={[
        styles.row,
        styles.navItem,
        {
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radii.md,
          backgroundColor: active ? theme.colors.surfaceRaised : "transparent",
        },
      ]}
    >
      <Text variant="label" color={active ? "text" : "textMuted"}>
        {label}
      </Text>
      {count ? (
        <View
          aria-hidden
          style={{
            backgroundColor: theme.tones.info.tint,
            borderRadius: theme.radii.pill,
            paddingHorizontal: theme.spacing.sm,
          }}
        >
          <Text variant="caption" style={{ color: theme.tones.info.ink }}>
            {count}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  spacer: { flex: 1 },
  topbar: { minHeight: touchTarget },
  navItem: { minHeight: touchTarget - 8 },
});
