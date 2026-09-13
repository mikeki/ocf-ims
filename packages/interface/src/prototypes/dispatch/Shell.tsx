// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { personLabel } from "@/lib/format";
import { ALERTS_UNREAD, EVENT, me } from "@/prototypes/dispatch/data";

// The wide-window shell (plan 09x § Decisions the round must also take):
// E15's left sidebar, or a single top bar with the same items. One
// component, one switch, so the round judges it by what it costs the table.
// Everything but Incidents is a placeholder that says which slice it is.

export type ShellMode = "sidebar" | "topbar";

/** E15's sidebar width — the number the brief says to judge against. */
export const SIDEBAR_WIDTH = 220;

const ITEMS: { label: string; note: string; count?: number }[] = [
  { label: "Incidents", note: "" },
  { label: "Reports", note: "Report review is 3c.3" },
  { label: "Roster", note: "The roster is 3c.4" },
  { label: "Dashboard", note: "The dashboard is 3c.5" },
  { label: "Alerts", note: "Alerts keep 3b.5's screen", count: ALERTS_UNREAD },
];

export interface ShellProps {
  mode: ShellMode;
  onNotice: (text: string) => void;
  children: ReactNode;
}

export function Shell(props: ShellProps) {
  const { mode, onNotice, children } = props;
  const theme = useTheme();
  const nav = ITEMS.map((item) => (
    <NavItem
      key={item.label}
      label={item.label}
      count={item.count}
      active={item.label === "Incidents"}
      horizontal={mode === "topbar"}
      onPress={() => {
        if (item.note) {
          onNotice(item.note);
        }
      }}
    />
  ));
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
      <Text variant="label" color="textMuted">
        {personLabel(me)}
      </Text>
      <TextButton
        label="Sign out"
        onPress={() => onNotice("Sign out — the session is not mounted here")}
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
            onPress={() =>
              onNotice("Event switcher — the events list, in a menu")
            }
          />
          <View style={[styles.row, { gap: theme.spacing.xs }]}>{nav}</View>
          <View style={styles.spacer} />
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
            onPress={() =>
              onNotice("Event switcher — the events list, in a menu")
            }
          />
        </View>
        <View style={{ gap: theme.spacing.xs }}>{nav}</View>
        <View style={styles.spacer} />
        <View style={{ paddingHorizontal: theme.spacing.sm }}>{who}</View>
      </View>
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

function EventSwitcher(props: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Event: ${EVENT.name}. Switch event`}
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
          <Text variant="heading">{EVENT.name}</Text>
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
  active: boolean;
  horizontal: boolean;
  onPress: () => void;
}) {
  const { label, count, active, horizontal, onPress } = props;
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count ? `${label}, ${count} unread` : label}
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.row,
            styles.navItem,
            {
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: horizontal ? theme.spacing.sm : theme.spacing.sm,
              borderRadius: theme.radii.md,
              backgroundColor: active
                ? theme.colors.surfaceRaised
                : "transparent",
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
        </PressFeedback>
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
