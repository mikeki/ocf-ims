// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { touchTarget } from "@/design/tokens";
import { useSession } from "@/session/provider";

// The wide-window shell for the 3c.5 round, a retyped copy of
// src/features/shell/Shell.tsx (top-bar mode, as 09z/09aa's own copies
// picked): Dashboard — active when the viewer has `access.writeIncidents`,
// absent otherwise (§ Gating) — beside Incidents / Reports / People / Alerts,
// every one but Dashboard an inert marker (this round only judges the
// dashboard itself). The page's own reachability is the harness's concern
// (Harness.tsx only ever mounts the dashboard body for a viewer that
// passes the gate), not this shell's.

export interface ShellProps {
  eventName: string;
  showDashboard: boolean;
  children: ReactNode;
}

export function Shell(props: ShellProps) {
  const { eventName, showDashboard, children } = props;
  const theme = useTheme();
  const { state, signOut } = useSession();
  const handle = state.status === "signedIn" ? state.auth.user : "";

  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          theme.elevation[1],
          {
            flexDirection: "row",
            alignItems: "center",
            minHeight: touchTarget,
            paddingHorizontal: theme.spacing.lg,
            gap: theme.spacing.lg,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <Text variant="heading">{eventName}</Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.xs,
          }}
        >
          {showDashboard ? <NavItem label="Dashboard" active /> : null}
          <NavItem label="Incidents" />
          <NavItem label="Reports" />
          <NavItem label="People" />
          <NavItem label="Alerts" />
        </View>
        <View style={{ flex: 1 }} />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
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
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function NavItem(props: { label: string; active?: boolean }) {
  const { label, active = false } = props;
  const theme = useTheme();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={`dashboard-shell-nav-${label.toLowerCase()}`}
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radii.md,
        backgroundColor: active ? theme.colors.surfaceRaised : "transparent",
      }}
    >
      <Text variant="label" color={active ? "text" : "textMuted"}>
        {label}
      </Text>
    </View>
  );
}
