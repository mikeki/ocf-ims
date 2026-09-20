// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import type { ComponentType, RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { toAppError } from "@/api/errors";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { drawerShare } from "@/design/tokens";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { neighboursOf } from "@/prototypes/reports/neighbours";
import type {
  ReportPaneHandle,
  ReportPaneProps,
  Viewer,
} from "@/prototypes/reports/types";
import { useEditReport } from "@/prototypes/reports/useEditReport";
import type { ReportQuery } from "@/prototypes/reports/useReportQuery";

// The report drawer (docs/plans/09z-reports-design.md § The prototype
// round), a retyped copy of src/features/dispatch/Drawer.tsx's shape: the
// panel over the table's right two thirds, the scrim, its own `ScreenHeader`
// — back "Reports", the number, prev/next among the visible rows, and "Full
// page". The body is the round's variant, chosen by the caller.

export interface ReportDrawerProps {
  q: ReportQuery;
  eventId: number;
  viewer: Viewer;
  Variant: ComponentType<ReportPaneProps>;
  onFull: () => void;
  onOpenIncident: (number: number) => void;
  onCreateIncident: () => void;
  handle?: RefObject<ReportPaneHandle | null>;
}

export function ReportDrawer(props: ReportDrawerProps) {
  const {
    q,
    eventId,
    viewer,
    Variant,
    onFull,
    onOpenIncident,
    onCreateIncident,
    handle,
  } = props;
  const theme = useTheme();
  const opened = q.opened;
  const edit = useEditReport(eventId, opened?.report.number ?? 0);
  const view = useQuery(
    ImsService.method.getReport,
    { eventId, reportNumber: opened?.report.number ?? 0 },
    { enabled: opened !== undefined },
  );
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
            <View style={styles.nav}>
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
          {view.isLoading ? (
            <LoadingState />
          ) : view.isError ? (
            <ErrorState error={toAppError(view.error)} onRetry={view.refetch} />
          ) : !view.data?.report?.report ? (
            <EmptyState title="Not found" />
          ) : (
            <Variant
              view={view.data.report}
              eventId={eventId}
              edit={edit}
              viewer={viewer}
              onOpenIncident={onOpenIncident}
              onCreateIncident={onCreateIncident}
              handle={handle}
            />
          )}
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
