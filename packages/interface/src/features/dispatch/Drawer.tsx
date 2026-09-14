// SPDX-License-Identifier: Apache-2.0

import type { RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { drawerShare } from "@/design/tokens";
import { neighboursOf } from "@/features/dispatch/neighbours";
import type { DispatchQuery } from "@/features/dispatch/useDispatchQuery";
import {
  IncidentScreen,
  type IncidentScreenHandle,
} from "@/features/incidents/IncidentScreen";
import { ScreenHeader } from "@/features/shell/ScreenHeader";

// The drawer (plan 09x criterion 7), promoted from
// src/prototypes/dispatch/Drawer.tsx: the panel over the table's right two
// thirds, the scrim, and its own header — `ScreenHeader` (plan 09y criterion
// 12): "Incidents" closes, the number, prev/next among the visible rows, and
// "Full page". The body is the incident editor, embedded (criterion 8):
// `chrome="embedded"` drops its own header, so this one is the only one
// shown. "Full page" and a second Enter push the real route (criterion 9,
// wired by the caller's `onFull`).

export interface DrawerProps {
  d: DispatchQuery;
  eventId: number;
  onFull: () => void;
  onOpenReport: (number: number) => void;
  onFileReport: (number: number) => void;
  onOpenAttachment: (number: number, entryId: number) => void;
  /** The keyboard map's `a` / `h` reach the embedded incident through this. */
  handle: RefObject<IncidentScreenHandle | null>;
}

export function Drawer(props: DrawerProps) {
  const {
    d,
    eventId,
    onFull,
    onOpenReport,
    onFileReport,
    onOpenAttachment,
    handle,
  } = props;
  const theme = useTheme();
  const opened = d.opened;
  if (!opened) {
    return null;
  }
  const number = opened.incident.number;
  const { prev, next } = neighboursOf(d.visible, number);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityLabel="Close the incident"
        onPress={d.close}
        style={[styles.scrim, { backgroundColor: theme.colors.overlay }]}
      />
      <View
        style={[
          styles.panel,
          theme.elevation[2],
          {
            width: `${drawerShare * 100}%`,
            backgroundColor: theme.colors.background,
            borderLeftColor: theme.colors.borderStrong,
          },
        ]}
        testID="dispatch-drawer"
      >
        <ScreenHeader
          title={`#${number}`}
          back={{ label: "Incidents", onPress: d.close }}
          right={
            <View style={styles.nav}>
              {prev !== undefined ? (
                <TextButton
                  label="‹ Prev"
                  onPress={() => d.open(prev)}
                  testID="dispatch-drawer-prev"
                />
              ) : null}
              {next !== undefined ? (
                <TextButton
                  label="Next ›"
                  onPress={() => d.open(next)}
                  testID="dispatch-drawer-next"
                />
              ) : null}
              <TextButton
                label="Full page"
                onPress={onFull}
                testID="dispatch-drawer-full"
              />
            </View>
          }
        />
        <View style={styles.fill}>
          <IncidentScreen
            chrome="embedded"
            handle={handle}
            eventId={eventId}
            number={number}
            onBack={d.close}
            onOpenIncident={d.open}
            onOpenReport={onOpenReport}
            onFileReport={() => onFileReport(number)}
            onOpenAttachment={(entryId) => onOpenAttachment(number, entryId)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  panel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  nav: { flexDirection: "row", alignItems: "center", gap: 6 },
});
