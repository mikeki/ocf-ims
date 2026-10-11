// SPDX-License-Identifier: Apache-2.0

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { Image } from "expo-image";
import { useImperativeHandle, useRef, useState } from "react";
import {
  Platform,
  Pressable,
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
import { ReportComposer } from "@/features/compose/ReportComposer";
import { useEventAccess, useEventName } from "@/features/events/hooks";
import { saveErrorText } from "@/features/incidents/controls/bits";
import { IMAGE_HEIGHT } from "@/features/incidents/JournalEntryRow";
import { SavingField } from "@/features/incidents/SavingField";
import { useAttachmentSource } from "@/features/incidents/useAttachmentSource";
import { formatTimestamp } from "@/lib/format";
import type { ReportPaneProps } from "@/prototypes/reports/types";
import { useSession } from "@/session/provider";

// Pieces the "Account" pane (docs/plans/09z-reports-design.md § The
// prototype round, "Account") shares with "Companion" 's left column — the
// whole document body: title, byline, the one thin controls strip, the
// dated paragraphs (oldest first, no card, no row borders), the composer at
// the end. Extracted here so Account.tsx and Companion.tsx both render the
// SAME body rather than two hand-kept copies (the round's own suggestion).
//
// Two findings recorded here rather than in the pane files, since both
// panes hit them the same way:
//  - `ReportComposer` (src/features/compose) forwards no ref, unlike
//    `AppendComposer`'s `focus()` — out of reach without editing a features
//    file, which this round may not do. `focusComposer` therefore scrolls
//    the composer into view rather than focusing its field; a real 3c.3
//    slice should give `ReportComposer` the same `forwardRef` pattern.
//  - The photo control: `ReportComposer` has no attach prop, so "Add photo"
//    is a `TextButton` stub that logs, per the brief.

export function myHandle(session: ReturnType<typeof useSession>): string {
  return session.state.status === "signedIn" ? session.state.auth.user : "";
}

function timeOf(entry: JournalEntry): number {
  return entry.created ? timestampDate(entry.created).getTime() : 0;
}

/** Whether `viewer` may strike `entry` (§ Gating): the composer's gate, and — absent
 * a wire signal for "write all vs. write own" once that gate is true — the harness's
 * own viewer role stands in for it, same as the fixtures do; see the builder's report. */
export function canStrike(
  entry: JournalEntry,
  mayAppend: boolean,
  viewer: ReportPaneProps["viewer"],
  ownHandle: string,
): boolean {
  return (
    mayAppend &&
    !entry.systemEntry &&
    (viewer !== "reporter" || entry.author === ownHandle)
  );
}

export function ToggleRow(props: {
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

/** The photo control's stand-in (see the header note): logs, never a dead control. */
export function AddPhotoStub() {
  return (
    <TextButton
      label="Add photo"
      onPress={() =>
        console.info(
          "[3c.3 round] Add photo — ReportComposer has no attach prop in this half",
        )
      }
      testID="report-composer-add-photo"
    />
  );
}

function ReportAttachmentThumbnail(props: {
  eventName: string;
  incidentNumber: number;
  entry: JournalEntry;
}) {
  const theme = useTheme();
  const source = useAttachmentSource(
    props.eventName,
    props.incidentNumber,
    props.entry.id,
  );
  if (!source) {
    return null;
  }
  return (
    <Image
      testID={`account-attachment-image-${props.entry.id}`}
      source={source}
      style={{
        height: IMAGE_HEIGHT,
        width: "100%",
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.textMuted,
      }}
      contentFit="cover"
      accessibilityLabel={`Photo ${props.entry.attachment?.id ?? ""}`}
    />
  );
}

function AccountEntry(props: {
  entry: JournalEntry;
  first: boolean;
  eventName: string;
  incidentNumber: number | undefined;
  canStrike: boolean;
  onStrike: () => void;
}) {
  const { entry, first, eventName, incidentNumber, canStrike, onStrike } =
    props;
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const muted = entry.systemEntry || entry.stricken === true;
  const showStrike =
    canStrike && (Platform.OS !== "web" || hovered) && !entry.systemEntry;
  const isImage =
    incidentNumber !== undefined &&
    entry.attachment?.mediaType?.startsWith("image/") === true;

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.entry,
        {
          gap: theme.spacing.xs,
          paddingTop: theme.spacing.md,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      <Box row align="baseline" gap="sm">
        <Text variant="caption" color="textMuted">
          {entry.onBehalfOf
            ? `${entry.author} · ${formatTimestamp(entry.created)} · on behalf of ${entry.onBehalfOf.handle || entry.onBehalfOf.name || `#${entry.onBehalfOf.personId}`}`
            : `${entry.author} · ${formatTimestamp(entry.created)}`}
        </Text>
        <View style={styles.spacer} />
        {showStrike ? (
          <TextButton
            variant="caption"
            label={entry.stricken ? "Unstrike" : "Strike"}
            onPress={onStrike}
            testID={`account-strike-${entry.id}`}
          />
        ) : null}
      </Box>
      <Text
        color={muted ? "textMuted" : "text"}
        style={
          entry.stricken ? { textDecorationLine: "line-through" } : undefined
        }
      >
        {entry.text}
      </Text>
      {entry.attachment && isImage && incidentNumber !== undefined ? (
        <ReportAttachmentThumbnail
          eventName={eventName}
          incidentNumber={incidentNumber}
          entry={entry}
        />
      ) : entry.attachment ? (
        <Text variant="caption" color="textMuted">
          {`Attachment ${entry.attachment.id}`}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function AccountBody(props: ReportPaneProps) {
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
      // ReportComposer forwards no ref (header note) — scrolled into view instead.
      focusComposer: () => scrollRef.current?.scrollToEnd({ animated: true }),
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
    .sort((a, b) => timeOf(a) - timeOf(b));

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

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.fill}
      keyboardShouldPersistTaps="handled"
      testID="account-pane"
    >
      <Box p="lg" gap="lg">
        <Box gap="xs">
          {editingSummary ? (
            <SavingField
              label="Summary"
              value={report.summary ?? ""}
              onSave={edit.setSummary}
              saveError={edit.status("summary").error}
              onDone={() => setEditingSummary(false)}
              autoFocus
              testID="account-summary-field"
            />
          ) : (
            <Text
              variant="title"
              color={report.summary ? "text" : "textMuted"}
              testID="account-summary-title"
            >
              {report.summary ||
                (mayEditSummary ? "No summary yet" : "(no summary)")}
            </Text>
          )}
          <Text variant="caption" color="textMuted">
            {`${report.createdBy?.handle || report.createdBy?.name || "Unknown"} · ${formatTimestamp(report.created)} · R-${report.number}`}
          </Text>
        </Box>

        <Box
          row
          align="center"
          gap="md"
          style={[
            styles.strip,
            {
              borderColor: theme.colors.border,
              paddingVertical: theme.spacing.sm,
            },
          ]}
          testID="account-controls-strip"
        >
          {linking ? (
            <Box row align="flex-end" gap="sm" style={styles.linkField}>
              <Box flex={1}>
                <Field
                  label="Incident number"
                  value={linkText}
                  onChangeText={setLinkText}
                  onSubmitEditing={() => void submitLink()}
                  keyboardType="number-pad"
                  error={linkError}
                  autoFocus
                  testID="account-link-field"
                />
              </Box>
            </Box>
          ) : report.incident ? (
            <Box row align="center" gap="sm">
              <TextButton
                label={`#${report.incident}`}
                variant="figure"
                onPress={() => onOpenIncident(report.incident ?? 0)}
                testID="account-incident-open"
              />
              {mayLink ? (
                <TextButton
                  label="Detach"
                  onPress={detach}
                  testID="account-incident-detach"
                />
              ) : null}
            </Box>
          ) : mayLink ? (
            <TextButton
              label="Link…"
              onPress={() => setLinking(true)}
              testID="account-incident-link-open"
            />
          ) : null}

          {mayEditSummary && !editingSummary ? (
            <TextButton
              label="Edit summary"
              onPress={() => setEditingSummary(true)}
              testID="account-summary-edit"
            />
          ) : null}

          <View style={styles.spacer} />
          <ToggleRow
            label="History"
            value={showHistory}
            onValueChange={setShowHistory}
            testID="account-toggle-history"
          />
          <ToggleRow
            label="Stricken"
            value={showStricken}
            onValueChange={setShowStricken}
            testID="account-toggle-stricken"
          />
        </Box>

        {!report.incident && access.writeIncidents ? (
          <TextButton
            label="Create an incident from this report"
            onPress={onCreateIncident}
            testID="account-create-incident"
          />
        ) : null}

        <Box>
          {entries.length === 0 ? (
            <Text color="textMuted">No entries yet.</Text>
          ) : (
            entries.map((entry, idx) => (
              <AccountEntry
                key={entry.id}
                entry={entry}
                first={idx === 0}
                eventName={eventName}
                incidentNumber={report.incident}
                canStrike={canStrike(entry, mayAppend, viewer, own)}
                onStrike={() => {
                  void edit.strike(entry.id, !entry.stricken).catch(() => {});
                }}
              />
            ))
          )}
        </Box>

        {mayAppend ? (
          <Box gap="sm">
            <ReportComposer
              eventId={eventId}
              number={report.number}
              author={own}
            />
            <AddPhotoStub />
          </Box>
        ) : null}
      </Box>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  spacer: { flex: 1 },
  strip: { flexWrap: "wrap", borderBottomWidth: StyleSheet.hairlineWidth },
  linkField: { flex: 1 },
  entry: { width: "100%" },
});
