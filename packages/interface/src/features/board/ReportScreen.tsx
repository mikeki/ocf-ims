// SPDX-License-Identifier: Apache-2.0

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQuery } from "@connectrpc/connect-query";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { ReportView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import type { ReactNode, RefObject } from "react";
import { useImperativeHandle, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { useReport } from "@/features/board/hooks";
import {
  ReportComposer,
  type ReportComposerHandle,
} from "@/features/compose/ReportComposer";
import { useEventAccess } from "@/features/events/hooks";
import {
  Card,
  FieldError,
  saveErrorText,
} from "@/features/incidents/controls/bits";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { LedgerRow } from "@/features/incidents/LedgerRow";
import { SavingField } from "@/features/incidents/SavingField";
import { useLiveEvent } from "@/features/live/useLiveEvent";
import {
  type EditReport,
  useEditReport,
} from "@/features/reports/useEditReport";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { formatTimestamp, personLabel } from "@/lib/format";
import { useSession } from "@/session/provider";

// The report as the Ledger (plan 09z criteria 8, 12; 3b.1 and 3b.3b before):
// one component on three surfaces — the phone screen, the table's drawer body
// and the full page's body ("embedded" drops the screen's own header, as
// `IncidentScreen` does). The summary is the heading, with Edit for whoever
// `may_edit_summary`; the Details card holds the incident (its number opens
// it; a writer sees Link… / Detach beside it), Created and Created by; the
// journal sits newest first in a ruled box with History / Stricken toggles on
// its heading line and the composer at its top. A viewer holding none of the
// gates sees no chevron, no Edit, no Link…, no composer. Hard cuts only.

/** What the reports keyboard map reaches into the pane. */
export interface ReportScreenHandle {
  focusComposer(): void;
  toggleSystemEntries(): void;
}

export interface ReportScreenProps {
  eventId: number;
  number: number;
  onBack: () => void;
  onOpenIncident: (number: number) => void;
  /** Open the incident form with this report's summary; the form links the report on file. */
  onCreateIncident: (summary: string) => void;
  /** "embedded" (the drawer, the full page) drops the screen's own header. */
  chrome?: "screen" | "embedded";
  handle?: RefObject<ReportScreenHandle | null>;
}

export function ReportScreen(props: ReportScreenProps) {
  const { eventId, number, onBack, chrome = "screen" } = props;
  const query = useReport(eventId, number);
  useLiveEvent(eventId);

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Box flex={1} bg="background">
        {chrome === "screen" ? (
          <ScreenHeader
            title={`R-${number}`}
            back={{ label: "Board", onPress: onBack }}
          />
        ) : null}
        {renderBody(query, props)}
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
    <Ledger
      view={view}
      eventId={props.eventId}
      onOpenIncident={props.onOpenIncident}
      onCreateIncident={props.onCreateIncident}
      handle={props.handle}
      refreshing={query.isRefetching && !query.isLoading}
      onRefresh={() => {
        void query.refetch();
      }}
    />
  );
}

interface LedgerProps {
  view: ReportView;
  eventId: number;
  onOpenIncident: (number: number) => void;
  onCreateIncident: (summary: string) => void;
  handle?: RefObject<ReportScreenHandle | null>;
  refreshing: boolean;
  onRefresh: () => void;
}

function Ledger(props: LedgerProps) {
  const { view, eventId, onOpenIncident, onCreateIncident, handle } = props;
  const theme = useTheme();
  const { state } = useSession();
  const access = useEventAccess(eventId);
  const report = view.report;
  const edit = useEditReport(eventId, report?.number ?? 0);
  const [editingSummary, setEditingSummary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showStricken, setShowStricken] = useState(false);
  const composerRef = useRef<ReportComposerHandle>(null);
  useImperativeHandle(
    handle,
    () => ({
      focusComposer: () => composerRef.current?.focus(),
      toggleSystemEntries: () => setShowHistory((v) => !v),
    }),
    [],
  );

  if (!report) {
    return null;
  }

  const author = state.status === "signedIn" ? state.auth.user : "";
  const mayEditSummary = view.mayEditSummary === true;
  const mayAppend = view.mayAddJournalEntry === true;
  const eventName = report.event ?? "";
  // The strike gate (plan 09z criterion 12): an author may strike their own
  // entries when they may add to the journal; another's only with
  // `writeIncidents`. System entries are never struck.
  const mayStrike = (entry: JournalEntry) =>
    !entry.systemEntry &&
    ((mayAppend && entry.author === author) || access.writeIncidents);

  const entries = report.journalEntries
    .filter(
      (e) => (showHistory || !e.systemEntry) && (showStricken || !e.stricken),
    )
    .slice()
    .sort((a, b) => timeOf(b.created) - timeOf(a.created));

  return (
    <ScrollView
      style={styles.fill}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          testID="report-refresh-control"
          refreshing={props.refreshing}
          onRefresh={props.onRefresh}
        />
      }
      testID="ledger-pane"
    >
      <Box p="lg" gap="lg">
        {editingSummary ? (
          <SavingField
            label="Summary"
            value={report.summary ?? ""}
            onSave={edit.setSummary}
            saveError={edit.status("summary").error}
            onDone={() => setEditingSummary(false)}
            autoFocus
            testID="ledger-summary-field"
          />
        ) : (
          <Box row align="flex-start" justify="space-between" gap="md">
            <Text
              variant="heading"
              color={report.summary ? "text" : "textMuted"}
              style={styles.shrink}
              testID="ledger-summary-value"
            >
              {report.summary ||
                (mayEditSummary ? "No summary yet" : "(no summary)")}
            </Text>
            {mayEditSummary ? (
              <TextButton
                label="Edit"
                onPress={() => setEditingSummary(true)}
                testID="ledger-summary-edit"
              />
            ) : null}
          </Box>
        )}

        <Card testID="ledger-details-card">
          <LedgerRow
            label="Incident"
            value={
              <IncidentValue
                eventId={eventId}
                incident={report.incident ?? 0}
                mayLink={access.writeReports}
                edit={edit}
                onOpenIncident={onOpenIncident}
              />
            }
            testID="ledger-incident-value"
          />
          <LedgerRow
            label="Created"
            value={
              <Text color="textMuted">{formatTimestamp(report.created)}</Text>
            }
          />
          <LedgerRow
            label="Created by"
            value={
              <Text color="textMuted">{personLabel(report.createdBy)}</Text>
            }
            last
          />
        </Card>

        {!report.incident && access.writeIncidents ? (
          <TextButton
            label="Create an incident from this report"
            onPress={() => onCreateIncident(report.summary ?? "")}
            testID="ledger-create-incident"
          />
        ) : null}

        <Box gap="sm" testID="journal">
          <Box row align="center" justify="space-between" gap="md">
            <Text variant="heading">Journal</Text>
            <Box row align="center" gap="md">
              <ToggleRow
                label="History"
                value={showHistory}
                onValueChange={setShowHistory}
                testID="ledger-toggle-history"
              />
              <ToggleRow
                label="Stricken"
                value={showStricken}
                onValueChange={setShowStricken}
                testID="ledger-toggle-stricken"
              />
            </Box>
          </Box>
          {mayAppend ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.lg,
                overflow: "hidden",
              }}
            >
              <ReportComposer
                ref={composerRef}
                eventId={eventId}
                number={report.number}
                author={author}
                eventName={eventName}
                attachFiles={access.attachFiles && eventName !== ""}
              />
            </View>
          ) : null}
          {entries.length === 0 ? (
            <Text color="textMuted">No entries yet.</Text>
          ) : (
            entries.map((entry) => (
              <JournalEntryRow
                key={entry.id}
                entry={entry}
                attachmentOn={{
                  eventName,
                  kind: "report",
                  number: report.number,
                }}
                onStrike={
                  mayStrike(entry)
                    ? () => {
                        void edit
                          .strike(entry.id, !entry.stricken)
                          .catch(() => {});
                      }
                    : undefined
                }
              />
            ))
          )}
          <FieldError error={edit.status("strike").error} />
        </Box>
      </Box>
    </ScrollView>
  );
}

interface IncidentValueProps {
  eventId: number;
  /** 0 = unlinked. */
  incident: number;
  mayLink: boolean;
  edit: EditReport;
  onOpenIncident: (number: number) => void;
}

/**
 * The Incident row's value. The number opens the incident, unless the viewer
 * cannot read it (a private incident answers 404): then it is plain text with
 * "Not visible to you" where the incident would render, never its content.
 * Link… / Detach are the words beside it, for `writeReports` only.
 */
function IncidentValue(props: IncidentValueProps) {
  const { eventId, incident, mayLink, edit, onOpenIncident } = props;
  const [linking, setLinking] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState<string | undefined>(undefined);
  const linked = incident > 0;
  const readable = useQuery(
    ImsService.method.getIncident,
    { eventId, incidentNumber: incident },
    { enabled: linked, retry: false },
  );
  const hidden =
    linked &&
    readable.error !== null &&
    toAppError(readable.error).kind === "notFound";

  const submitLink = async () => {
    const trimmed = linkText.trim();
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== trimmed) {
      setLinkError("An incident number, like 214.");
      return;
    }
    setLinkError(undefined);
    try {
      await edit.setIncident(n);
      setLinking(false);
      setLinkText("");
    } catch (e) {
      const err = toAppError(e);
      setLinkError(
        err.kind === "notFound"
          ? `There's no incident #${n} here.`
          : saveErrorText(err),
      );
    }
  };

  if (linking) {
    return (
      <Box gap="sm">
        <Field
          label="Incident number"
          value={linkText}
          onChangeText={setLinkText}
          onSubmitEditing={() => void submitLink()}
          keyboardType="number-pad"
          error={linkError}
          autoFocus
          testID="ledger-link-field"
        />
        <Box row align="center" gap="md">
          <TextButton
            label="Link"
            onPress={() => void submitLink()}
            testID="ledger-link-go"
          />
          <TextButton
            label="Cancel"
            onPress={() => {
              setLinking(false);
              setLinkText("");
              setLinkError(undefined);
            }}
            testID="ledger-link-cancel"
          />
        </Box>
      </Box>
    );
  }

  if (!linked) {
    return (
      <Box row align="center" gap="md">
        <Text color="textMuted">None</Text>
        {mayLink ? (
          <TextButton
            label="Link…"
            onPress={() => setLinking(true)}
            testID="ledger-incident-link-open"
          />
        ) : null}
      </Box>
    );
  }

  return (
    <Box gap="xs">
      <Box row align="center" gap="md">
        {hidden ? (
          <Text
            variant="figure"
            testID="ledger-incident-number"
          >{`#${incident}`}</Text>
        ) : (
          <TextButton
            label={`#${incident}`}
            variant="figure"
            onPress={() => onOpenIncident(incident)}
            testID="ledger-incident-open"
          />
        )}
        {mayLink ? (
          <TextButton
            label="Detach"
            onPress={() => {
              void edit.setIncident(0).catch(() => {});
            }}
            testID="ledger-incident-detach"
          />
        ) : null}
      </Box>
      {hidden ? (
        <Text
          variant="caption"
          color="textMuted"
          testID="ledger-incident-hidden"
        >
          Not visible to you
        </Text>
      ) : null}
      <FieldError error={edit.status("incident").error} />
    </Box>
  );
}

function ToggleRow(props: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <Box row align="center" gap="xs">
      <Text variant="label" color="textMuted">
        {props.label}
      </Text>
      <Switch
        accessibilityLabel={`Show ${props.label.toLowerCase()} entries`}
        value={props.value}
        onValueChange={props.onValueChange}
        testID={props.testID}
      />
    </Box>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
});

function timeOf(ts: Timestamp | undefined): number {
  return ts ? timestampDate(ts).getTime() : 0;
}
