// SPDX-License-Identifier: Apache-2.0

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { useImperativeHandle, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { useEventAccess, useEventName } from "@/features/events/hooks";
import { Card, saveErrorText } from "@/features/incidents/controls/bits";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { LedgerRow } from "@/features/incidents/LedgerRow";
import { SavingField } from "@/features/incidents/SavingField";
import { formatTimestamp, personLabel } from "@/lib/format";
import {
  AddPhotoStub,
  canStrike,
  myHandle,
  ToggleRow,
} from "@/prototypes/reports/accountParts";
import { LedgerComposer } from "@/prototypes/reports/LedgerComposer";
import type { ReportPaneProps } from "@/prototypes/reports/types";
import { useSession } from "@/session/provider";

// Variant (docs/plans/09z-reports-design.md § The prototype round,
// "Ledger"): the 3c.2 Ledger applied as is — the summary as the heading
// with Edit (creator / admin), a Details card of `label · value · ›` rows
// (Incident, Created, Created by), the journal newest first with the
// composer at its top, strike on the entry's header line, the History /
// Stricken toggles on the heading line.
//
// Departure: the Incident row does NOT use `LedgerRow`'s own `may`+`control`
// mechanism (the chevron, the whole row as one hard-cut Pressable) — that
// row also has to OPEN the incident on the same value, and a row-wide
// edit-Pressable wrapping an inner "open" target gives one tap two
// competing meanings. Link… / Detach render as their own words instead
// (still a hard cut, still no dead control); Created / Created by stay
// fully read-only, as the incident's own screen keeps them.

function timeOf(entry: JournalEntry): number {
  return entry.created ? timestampDate(entry.created).getTime() : 0;
}

export function Ledger(props: ReportPaneProps) {
  const { view, eventId, edit, viewer, onOpenIncident, onCreateIncident } =
    props;
  const theme = useTheme();
  const session = useSession();
  const eventName = useEventName(eventId);
  const access = useEventAccess(eventId);
  const report = view.report;
  const [editingSummary, setEditingSummary] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState<string | undefined>(undefined);
  const [showHistory, setShowHistory] = useState(false);
  const [showStricken, setShowStricken] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useImperativeHandle(
    props.handle,
    () => ({
      // The composer docks at the journal's top, just under the Details
      // card — scrolling to the top brings it into view (ReportComposer
      // forwards no ref to focus directly; see accountParts.tsx's note).
      focusComposer: () =>
        scrollRef.current?.scrollTo({ y: 0, animated: true }),
      toggleSystemEntries: () => setShowHistory((v) => !v),
    }),
    [],
  );

  if (!report) {
    return null;
  }

  const own = myHandle(session);
  const mayEditSummary = view.mayEditSummary === true;
  const mayAppend = view.mayAddJournalEntry === true;
  const mayLink = access.writeReports;

  const entries = report.journalEntries
    .filter(
      (e) => (showHistory || !e.systemEntry) && (showStricken || !e.stricken),
    )
    .slice()
    .sort((a, b) => timeOf(b) - timeOf(a));

  const detach = () => {
    void edit.setIncident(0).catch(() => {});
  };

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

  const incidentValue = linking ? (
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
  ) : report.incident ? (
    <Box row align="center" gap="sm">
      <TextButton
        label={`#${report.incident}`}
        variant="figure"
        onPress={() => onOpenIncident(report.incident ?? 0)}
        testID="ledger-incident-open"
      />
      {mayLink ? (
        <TextButton
          label="Detach"
          onPress={detach}
          testID="ledger-incident-detach"
        />
      ) : null}
    </Box>
  ) : (
    <Box row align="center" gap="sm">
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

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.fill}
      keyboardShouldPersistTaps="handled"
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
            value={incidentValue}
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
            onPress={onCreateIncident}
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
              <LedgerComposer
                eventId={eventId}
                number={report.number}
                author={own}
              />
            </View>
          ) : null}
          {mayAppend ? <AddPhotoStub /> : null}
          {entries.length === 0 ? (
            <Text color="textMuted">No entries yet.</Text>
          ) : (
            entries.map((entry) => (
              <JournalEntryRow
                key={entry.id}
                entry={entry}
                attachmentOn={
                  report.incident
                    ? { eventName, incidentNumber: report.incident }
                    : undefined
                }
                onStrike={
                  canStrike(entry, mayAppend, viewer, own)
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
        </Box>
      </Box>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
});
