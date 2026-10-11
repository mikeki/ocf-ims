// SPDX-License-Identifier: Apache-2.0

import type { RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { drawerShare } from "@/design/tokens";
import {
  ReportScreen,
  type ReportScreenHandle,
} from "@/features/board/ReportScreen";
import { neighboursOf } from "@/features/reports/neighbours";
import type { ReportQuery } from "@/features/reports/useReportQuery";
import { ScreenHeader } from "@/features/shell/ScreenHeader";

// The report drawer (plan 09z criterion 9), shaped as
// src/features/dispatch/Drawer.tsx: the panel over the table's right two
// thirds, the scrim, its own `ScreenHeader` (back "Reports", the number,
// prev / next among the visible rows, "Full page"). The body is the Ledger,
// embedded.

export interface ReportDrawerProps {
  q: ReportQuery;
  eventId: number;
  onFull: () => void;
  onOpenIncident: (number: number) => void;
  onCreateIncident: (summary: string) => void;
  handle?: RefObject<ReportScreenHandle | null>;
}

export function ReportDrawer(props: ReportDrawerProps) {
  const { q, eventId, onFull, onOpenIncident, onCreateIncident, handle } =
    props;
  const theme = useTheme();
  const opened = q.opened;
  if (!opened) {
    return null;
  }
  const number = opened.report.number;
  const { prev, next } = neighboursOf(q.visible, number);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityLabel="Close the report"
        onPress={q.close}
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
        testID="report-drawer"
      >
        <ScreenHeader
          title={`R-${number}`}
          back={{ label: "Reports", onPress: q.close }}
          right={
            <View style={[styles.nav, { gap: theme.spacing.sm }]}>
              {prev !== undefined ? (
                <TextButton
                  label="‹ Prev"
                  onPress={() => q.open(prev)}
                  testID="report-drawer-prev"
                />
              ) : null}
              {next !== undefined ? (
                <TextButton
                  label="Next ›"
                  onPress={() => q.open(next)}
                  testID="report-drawer-next"
                />
              ) : null}
              <TextButton
                label="Full page"
                onPress={onFull}
                testID="report-drawer-full"
              />
            </View>
          }
        />
        <View style={styles.fill}>
          <ReportScreen
            key={number}
            chrome="embedded"
            eventId={eventId}
            number={number}
            onBack={q.close}
            onOpenIncident={onOpenIncident}
            onCreateIncident={onCreateIncident}
            handle={handle}
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
  nav: { flexDirection: "row", alignItems: "center" },
});
