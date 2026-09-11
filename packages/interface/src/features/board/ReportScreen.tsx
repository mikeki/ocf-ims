// SPDX-License-Identifier: Apache-2.0

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ReportView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import type { ReactNode } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { useReport } from "@/features/board/hooks";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { formatTimestamp, personLabel } from "@/lib/format";

// A report, read-only (plan 09q, slice 3b.1).
//
// This exists because the Board lists reports, and a row you cannot open is a
// row whose unread mark can never be cleared — the watermark is written on
// OPEN. It is deliberately the smallest thing that makes the Board coherent:
// the header, who filed it and when, whether it is attached to an incident,
// and the journal. **Writing** a report — filing, appending, linking, the
// may_edit_summary / may_add_journal_entry gating — is 3b.3.

export interface ReportScreenProps {
  eventId: number;
  number: number;
  onBack: () => void;
}

export function ReportScreen(props: ReportScreenProps) {
  const { eventId, number, onBack } = props;
  const query = useReport(eventId, number);

  return (
    <Box flex={1} bg="background">
      <ScreenHeader
        title={`R-${number}`}
        back={{ label: "Board", onPress: onBack }}
      />
      {renderBody(query, number, onBack)}
    </Box>
  );
}

function renderBody(
  query: ReturnType<typeof useReport>,
  number: number,
  onBack: () => void,
): ReactNode {
  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.error) {
    const error = toAppError(query.error);
    if (error.kind === "notFound") {
      return (
        <EmptyState
          title="Not found"
          message={`There's no report R-${number} here.`}
          action={{ label: "Back to the board", onPress: onBack }}
        />
      );
    }
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const view = query.data?.report;
  if (!view?.report) {
    return null;
  }
  return (
    <ReportDetail
      view={view}
      refreshing={query.isRefetching && !query.isLoading}
      onRefresh={() => {
        void query.refetch();
      }}
    />
  );
}

interface ReportDetailProps {
  view: ReportView;
  refreshing: boolean;
  onRefresh: () => void;
}

function ReportDetail(props: ReportDetailProps) {
  const theme = useTheme();
  const report = props.view.report;
  if (!report) {
    return null;
  }
  const entries = report.journalEntries
    .slice()
    .sort((a, b) => timeOf(a.created) - timeOf(b.created));

  return (
    <ScrollView
      style={{ flex: 1 }}
      refreshControl={
        <RefreshControl
          testID="report-refresh-control"
          refreshing={props.refreshing}
          onRefresh={props.onRefresh}
        />
      }
    >
      <Box p="lg" gap="lg">
        <Box gap="sm">
          <Text
            variant="title"
            testID="report-number"
          >{`R-${report.number}`}</Text>
          <Text variant="heading">{report.summary || "(no summary)"}</Text>
        </Box>

        <Box
          bg="surface"
          radius="lg"
          p="lg"
          gap="xs"
          style={{ borderWidth: 1, borderColor: theme.colors.border }}
        >
          <Text variant="caption" color="textMuted">
            {`Filed ${formatTimestamp(report.created)} by ${personLabel(report.createdBy)}`}
          </Text>
          <Text variant="caption" color="textMuted">
            {report.incident
              ? `Attached to incident #${report.incident}`
              : "Not attached to an incident"}
          </Text>
        </Box>

        <Box gap="sm">
          <Text variant="heading">Journal</Text>
          {entries.length === 0 ? (
            <Text color="textMuted">No entries yet.</Text>
          ) : (
            entries.map((entry) => (
              <JournalEntryRow key={entry.id} entry={entry} />
            ))
          )}
        </Box>
      </Box>
    </ScrollView>
  );
}

function timeOf(ts: Timestamp | undefined): number {
  return ts ? timestampDate(ts).getTime() : 0;
}
