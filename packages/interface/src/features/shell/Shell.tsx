// SPDX-License-Identifier: Apache-2.0

import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { useAlerts } from "@/features/alerts/hooks";
import { useEventAccess, useEventName } from "@/features/events/hooks";
import { useLiveEvent } from "@/features/live/useLiveEvent";
import { useSession } from "@/session/provider";

// The wide-window shell (plan 09x criterion 2), promoted from
// src/prototypes/dispatch/Shell.tsx: a top bar carrying the event, Incidents
// (the only built destination this slice — Reports, Roster and Dashboard are
// 3c.3-3c.5's, one item each, and a wide window having no reports list yet is
// accepted), Alerts, the client's first visible stream-state word, the
// signed-in identity and Sign out, and New incident when the caller may
// write. The sidebar path from the D2 round survives ("the pick", 09x) so a
// later setting is a line item rather than a rewrite, but nothing sets it.

export type ShellMode = "sidebar" | "topbar";

/** E15's sidebar width — the number the round judged the top bar against. */
export const SIDEBAR_WIDTH = 220;

export interface ShellProps {
  mode?: ShellMode;
  eventId: number;
  children: ReactNode;
}

export function Shell(props: ShellProps) {
  const { mode = "topbar", eventId, children } = props;
  const theme = useTheme();
  const router = useRouter();
  const { state, signOut } = useSession();
  const eventName = useEventName(eventId) || `Event ${eventId}`;
  const access = useEventAccess(eventId);
  const alerts = useAlerts();
  const live = useLiveEvent(eventId);
  const unread = Number(alerts.data?.unread ?? 0);
  // "Signed in as …" elsewhere in the app treats this string as the identity
  // (EventsScreen); there is no separate display name on GetAuthStatusResponse.
  const handle = state.status === "signedIn" ? state.auth.user : "";

  const nav = (
    <View
      style={[
        mode === "topbar" ? styles.row : styles.column,
        { gap: theme.spacing.xs },
      ]}
    >
      <NavItem label="Incidents" active horizontal={mode === "topbar"} />
      <NavItem
        label="Alerts"
        count={unread}
        horizontal={mode === "topbar"}
        onPress={() => router.push("/alerts")}
      />
    </View>
  );

  const newIncident = access.writeIncidents ? (
    <Button
      label="New incident"
      variant="secondary"
      onPress={() => router.push(`/events/${eventId}/incidents/new`)}
    />
  ) : null;

  // The first visible stream state (criterion 2): nothing while live, so the
  // common case is silent.
  const stream = live ? null : (
    <Text
      variant="label"
      color="textMuted"
      accessibilityLiveRegion="polite"
      testID="dispatch-stream-state"
    >
      Reconnecting…
    </Text>
  );

  const who = (
    <View
      style={[
        mode === "topbar" ? styles.row : styles.column,
        {
          gap: theme.spacing.sm,
          alignItems: mode === "topbar" ? "center" : "flex-start",
        },
      ]}
    >
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
  );

  if (mode === "topbar") {
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
          <EventSwitcher
            name={eventName}
            onPress={() => router.push("/events")}
          />
          {nav}
          <View style={styles.spacer} />
          {stream}
          {newIncident}
          {who}
        </View>
        <View style={styles.fill}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <View
        style={[
          styles.sidebar,
          {
            width: SIDEBAR_WIDTH,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.sm,
            gap: theme.spacing.md,
            backgroundColor: theme.colors.surface,
            borderRightColor: theme.colors.border,
          },
        ]}
      >
        <View style={{ paddingHorizontal: theme.spacing.sm }}>
          <EventSwitcher
            name={eventName}
            onPress={() => router.push("/events")}
          />
        </View>
        {nav}
        {stream ? (
          <View style={{ paddingHorizontal: theme.spacing.sm }}>{stream}</View>
        ) : null}
        {newIncident ? (
          <View style={{ paddingHorizontal: theme.spacing.sm }}>
            {newIncident}
          </View>
        ) : null}
        <View style={styles.spacer} />
        <View style={{ paddingHorizontal: theme.spacing.sm }}>{who}</View>
      </View>
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

function EventSwitcher(props: { name: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Event: ${props.name}. Switch event`}
      onPress={props.onPress}
      pressRetentionOffset={pressRetentionOffset}
      style={styles.hug}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.row,
            { gap: theme.spacing.xs, minHeight: touchTarget },
          ]}
        >
          <Text variant="heading">{props.name}</Text>
          <Text variant="heading" color="textMuted" aria-hidden>
            ▾
          </Text>
        </PressFeedback>
      )}
    </Pressable>
  );
}

function NavItem(props: {
  label: string;
  count?: number;
  active?: boolean;
  horizontal: boolean;
  onPress?: () => void;
}) {
  const { label, count, active = false, onPress } = props;
  const theme = useTheme();
  const content = (
    <View
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
  // The current page (Incidents, this slice) has nowhere to navigate to: a
  // plain marker, not a dead pressable.
  if (!onPress) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel={count ? `${label}, ${count} unread` : label}
        testID={`shell-nav-${label.toLowerCase()}`}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count ? `${label}, ${count} unread` : label}
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
      testID={`shell-nav-${label.toLowerCase()}`}
    >
      {({ pressed }) => (
        <PressFeedback pressed={pressed}>{content}</PressFeedback>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  column: { flexDirection: "column" },
  spacer: { flex: 1 },
  hug: { alignSelf: "flex-start" },
  topbar: { minHeight: touchTarget },
  body: { flex: 1, flexDirection: "row", alignItems: "stretch" },
  sidebar: { borderRightWidth: StyleSheet.hairlineWidth },
  navItem: { minHeight: touchTarget - 8 },
});
