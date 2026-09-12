// SPDX-License-Identifier: Apache-2.0

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ReportView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
} from "react-native";
import { type AppError, toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { useReport } from "@/features/board/hooks";
import { useLinkReport } from "@/features/compose/hooks";
import { ReportComposer } from "@/features/compose/ReportComposer";
import { useEventAccess } from "@/features/events/hooks";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { useLiveEvent } from "@/features/live/useLiveEvent";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { formatTimestamp, personLabel } from "@/lib/format";
import { useSession } from "@/session/provider";

// A report (plan 09q, slice 3b.1; 09t, slice 3b.3b): the journal, the docked
// composer when the caller may add to it, the incident it is attached to as
// a row that opens it, and — for a writer with no link — attach by number or
// create an incident from it. Summary editing waits for 3c's editor.

export interface ReportScreenProps {
  eventId: number;
  number: number;
  onBack: () => void;
  onOpenIncident: (number: number) => void;
  /** Open the incident form with this report's summary; the form links the report on file. */
  onCreateIncident: (summary: string) => void;
}

export function ReportScreen(props: ReportScreenProps) {
  const { eventId, number, onBack } = props;
  const query = useReport(eventId, number);
  useLiveEvent(eventId);
  const { state } = useSession();
  const author = state.status === "signedIn" ? state.auth.user : "";
  const mayAppend = query.data?.report?.mayAddJournalEntry === true;

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Box flex={1} bg="background">
        <ScreenHeader
          title={`R-${number}`}
          back={{ label: "Board", onPress: onBack }}
        />
        {renderBody(query, props)}
        {mayAppend ? (
          <ReportComposer eventId={eventId} number={number} author={author} />
        ) : null}
      </Box>
    </KeyboardAvoidingView>
  );
}

function renderBody(
  query: ReturnType<typeof useReport>,
  props: ReportScreenProps,
): ReactNode {
  const { number, onBack } = props;
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
      eventId={props.eventId}
      onOpenIncident={props.onOpenIncident}
      onCreateIncident={props.onCreateIncident}
      refreshing={query.isRefetching && !query.isLoading}
      onRefresh={() => {
        void query.refetch();
      }}
    />
  );
}

interface ReportDetailProps {
  view: ReportView;
  eventId: number;
  onOpenIncident: (number: number) => void;
  onCreateIncident: (summary: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}

function ReportDetail(props: ReportDetailProps) {
  const { view, eventId, onOpenIncident, onCreateIncident } = props;
  const theme = useTheme();
  const access = useEventAccess(eventId);
  const report = view.report;
  if (!report) {
    return null;
  }
  const entries = report.journalEntries
    .slice()
    .sort((a, b) => timeOf(a.created) - timeOf(b.created));

  return (
    <ScrollView
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
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
          gap="sm"
          style={{ borderWidth: 1, borderColor: theme.colors.border }}
        >
          <Text variant="caption" color="textMuted">
            {`Filed ${formatTimestamp(report.created)} by ${personLabel(report.createdBy)}`}
          </Text>
          {report.incident ? (
            <Box row align="center" gap="sm">
              <Text variant="caption" color="textMuted">
                Attached to incident
              </Text>
              <TextButton
                label={`#${report.incident}`}
                variant="figure"
                onPress={() => onOpenIncident(report.incident ?? 0)}
                testID="report-incident-link"
              />
            </Box>
          ) : access.writeIncidents ? (
            <AttachControls
              eventId={eventId}
              number={report.number}
              onCreateIncident={() => onCreateIncident(report.summary ?? "")}
            />
          ) : (
            <Text variant="caption" color="textMuted">
              Not attached to an incident
            </Text>
          )}
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

/** A writer's two ways to put an unattached report on an incident. */
function AttachControls(props: {
  eventId: number;
  number: number;
  onCreateIncident: () => void;
}) {
  const { link, isPending } = useLinkReport(props.eventId, props.number);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<AppError | undefined>(undefined);

  const attach = async () => {
    setError(undefined);
    setFailure(undefined);
    const trimmed = text.trim();
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== trimmed) {
      setError("An incident number, like 214.");
      return;
    }
    try {
      await link(n);
    } catch (e) {
      const err = toAppError(e);
      if (err.kind === "notFound") {
        setError(`There's no incident #${n} in this event.`);
      } else {
        setFailure(err);
      }
      return;
    }
    setText("");
  };

  return (
    <Box gap="sm">
      <Text variant="caption" color="textMuted">
        Not attached to an incident
      </Text>
      <Box row align="flex-end" gap="sm">
        <Box flex={1}>
          <Field
            label="Attach to incident"
            value={text}
            onChangeText={setText}
            placeholder="Number"
            keyboardType="number-pad"
            error={error}
            testID="attach-incident"
          />
        </Box>
        <Button
          label="Attach"
          variant="secondary"
          loading={isPending}
          disabled={text.trim().length === 0}
          onPress={() => {
            void attach();
          }}
          testID="attach-incident-go"
        />
      </Box>
      {failure ? <ErrorState error={failure} /> : null}
      <TextButton
        label="Create an incident from this report"
        onPress={props.onCreateIncident}
        testID="create-incident-from-report"
      />
    </Box>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

function timeOf(ts: Timestamp | undefined): number {
  return ts ? timestampDate(ts).getTime() : 0;
}
