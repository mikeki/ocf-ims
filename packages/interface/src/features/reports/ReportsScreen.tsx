// SPDX-License-Identifier: Apache-2.0

import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { toAppError } from "@/api/errors";
import type { ReportScreenHandle } from "@/features/board/ReportScreen";
import { HelpSheet } from "@/features/dispatch/HelpSheet";
import { useKeyboardMap } from "@/features/dispatch/useKeyboardMap";
import { useEventAccess } from "@/features/events/hooks";
import { useLiveEvent } from "@/features/live/useLiveEvent";
import { useReportRows } from "@/features/reports/hooks";
import { ReportDrawer } from "@/features/reports/ReportDrawer";
import { ReportFilterBar } from "@/features/reports/ReportFilterBar";
import { ReportTable } from "@/features/reports/ReportTable";
import { reportHelpRows } from "@/features/reports/reportHelp";
import { serializeQuery } from "@/features/reports/reportQuery";
import { useReportQuery } from "@/features/reports/useReportQuery";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";

// The reports table screen (plan 09z criterion 7), composed inside `Shell` by
// the reports index route on a wide window (the Board keeps the phone). The
// 3c.1 table typed on `ReportView`: URL-driven state, live rows through the
// hub's report pokes (`useLiveEvent`), the drawer over the right two thirds
// and the full page. A second Enter, or the drawer's "Full page", pushes the
// real route with the table's query carried.

export interface ReportsScreenProps {
  eventId: number;
}

export function ReportsScreen(props: ReportsScreenProps) {
  const { eventId } = props;
  const router = useRouter();
  const access = useEventAccess(eventId);
  const rowsQuery = useReportRows(eventId);
  useLiveEvent(eventId);
  const reports = rowsQuery.data?.reports ?? [];
  const q = useReportQuery(reports, rowsQuery.data !== undefined);
  const [help, setHelp] = useState(false);
  const handle = useRef<ReportScreenHandle>(null);

  const onFull = useCallback(() => {
    const opened = q.opened;
    if (!opened) {
      return;
    }
    const carried = serializeQuery(q.query);
    const params: Record<string, string> = { from: "table" };
    for (const [key, value] of Object.entries(carried)) {
      if (value !== undefined && key !== "sel" && key !== "open") {
        params[key] = value;
      }
    }
    router.push({
      pathname: `/events/${eventId}/reports/${opened.report.number}`,
      params,
    });
  }, [q.opened, q.query, eventId, router]);

  const onNewReport = access.writeReports
    ? () => router.push(`/events/${eventId}/reports/new`)
    : undefined;

  useKeyboardMap({
    query: q.query,
    visible: q.visible,
    help,
    setHelp,
    setQuery: q.setQuery,
    select: q.select,
    open: q.open,
    close: q.close,
    move: q.move,
    onFull,
    onNew: onNewReport,
    searchRef: q.searchRef,
    handle,
  });

  if (rowsQuery.isLoading) {
    return <LoadingState />;
  }
  if (rowsQuery.error) {
    const error = toAppError(rowsQuery.error);
    if (error.kind === "forbidden") {
      return (
        <EmptyState
          title="No access"
          message="You don't have access to this event's reports."
        />
      );
    }
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void rowsQuery.refetch();
        }}
      />
    );
  }

  return (
    <View style={styles.fill}>
      <ReportFilterBar
        q={q}
        total={reports.length}
        onHelp={() => setHelp(true)}
      />
      <View style={styles.fill}>
        <ReportTable q={q} onRowPress={q.open} />
        <ReportDrawer
          q={q}
          eventId={eventId}
          onFull={onFull}
          handle={handle}
          onOpenIncident={(n) =>
            router.push(`/events/${eventId}/incidents/${n}`)
          }
          onCreateIncident={(summary) =>
            router.push({
              pathname: `/events/${eventId}/incidents/new`,
              params: {
                report: String(q.opened?.report.number ?? 0),
                summary,
              },
            })
          }
        />
      </View>
      <HelpSheet
        open={help}
        onClose={() => setHelp(false)}
        rows={reportHelpRows(access.writeReports)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
