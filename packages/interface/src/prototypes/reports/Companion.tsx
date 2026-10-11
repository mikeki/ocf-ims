// SPDX-License-Identifier: Apache-2.0

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { toAppError } from "@/api/errors";
import { PressFeedback } from "@/design/motion";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";
import { useEventAccess, useEventName } from "@/features/events/hooks";
import { useIncident, useIncidents } from "@/features/incidents/hooks";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { formatTimestamp, priorityLabel, stateLabel } from "@/lib/format";
import { AccountBody } from "@/prototypes/reports/accountParts";
import type { ReportPaneProps } from "@/prototypes/reports/types";

// Variant (docs/plans/09z-reports-design.md § The prototype round,
// "Companion"): the pane splits — the report (Account's body, unchanged,
// from accountParts.tsx) on the left, the linked incident read-only on the
// right, or the link control itself when unlinked. Stacks at the 400 px
// phone pane (decision 1).

/** Below this the two columns stack (the 400 px phone pass, decision 1). */
const STACK_BELOW = 480;

function timeOf(entry: JournalEntry): number {
  return entry.created ? timestampDate(entry.created).getTime() : 0;
}

export function Companion(props: ReportPaneProps) {
  const { view, eventId, edit, onCreateIncident } = props;
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const stacked = width < STACK_BELOW;
  const report = view.report;
  if (!report) {
    return null;
  }

  return (
    <View style={[styles.fill, stacked ? styles.column : styles.row]}>
      <View style={styles.half}>
        <AccountBody {...props} />
      </View>
      <View
        style={[
          styles.half,
          stacked
            ? {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.border,
              }
            : {
                borderLeftWidth: StyleSheet.hairlineWidth,
                borderLeftColor: theme.colors.border,
              },
        ]}
      >
        <RightColumn
          eventId={eventId}
          incidentNumber={report.incident}
          reportEntries={report.journalEntries}
          edit={edit}
          onCreateIncident={onCreateIncident}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row" },
  column: { flexDirection: "column" },
  half: { flex: 1, minWidth: 0 },
  searchRow: { flexDirection: "row", alignItems: "center" },
  searchSummary: { flexShrink: 1 },
  badgeRow: { flexWrap: "wrap" },
});

interface RightColumnProps {
  eventId: number;
  incidentNumber: number | undefined;
  reportEntries: JournalEntry[];
  edit: ReportPaneProps["edit"];
  onCreateIncident: () => void;
}

function RightColumn(props: RightColumnProps) {
  const { eventId, incidentNumber, reportEntries, edit, onCreateIncident } =
    props;
  const access = useEventAccess(eventId);

  if (incidentNumber) {
    return (
      <LinkedIncidentColumn
        eventId={eventId}
        incidentNumber={incidentNumber}
        reportEntries={reportEntries}
        edit={edit}
        mayLink={access.writeReports}
      />
    );
  }

  return (
    <Box p="lg" gap="md" style={styles.fill} testID="companion-unlinked">
      {access.writeReports ? (
        <LinkSearch eventId={eventId} edit={edit} />
      ) : (
        <Text color="textMuted">Not attached to an incident</Text>
      )}
      {access.writeIncidents ? (
        <TextButton
          label="Create an incident from this report"
          onPress={onCreateIncident}
          testID="companion-create-incident"
        />
      ) : null}
    </Box>
  );
}

function LinkSearch(props: { eventId: number; edit: ReportPaneProps["edit"] }) {
  const { eventId, edit } = props;
  const [search, setSearch] = useState("");
  const list = useIncidents(eventId);
  const query = search.trim().toLowerCase();
  const results = (list.data?.incidents ?? []).filter((v) => {
    if (!query) {
      return false;
    }
    const incident = v.incident;
    return (
      String(incident?.number ?? "").includes(query) ||
      (incident?.summary ?? "").toLowerCase().includes(query)
    );
  });

  return (
    <Box gap="sm">
      <Field
        label="Find an incident"
        value={search}
        onChangeText={setSearch}
        placeholder="Number or summary"
        testID="companion-search"
      />
      {results.slice(0, 8).map((v) => {
        const incident = v.incident;
        if (!incident) {
          return null;
        }
        return (
          <IncidentSearchRow
            key={incident.number}
            incident={incident}
            onPress={() => {
              void edit.setIncident(incident.number).catch(() => {});
            }}
          />
        );
      })}
    </Box>
  );
}

function IncidentSearchRow(props: { incident: Incident; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Link incident #${props.incident.number}`}
      onPress={props.onPress}
      pressRetentionOffset={pressRetentionOffset}
      testID={`companion-search-result-${props.incident.number}`}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.searchRow,
            {
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.spacing.sm,
              borderRadius: theme.radii.md,
              gap: theme.spacing.sm,
            },
          ]}
        >
          <Text variant="figure">{`#${props.incident.number}`}</Text>
          <Text numberOfLines={1} style={styles.searchSummary}>
            {props.incident.summary || "(no summary)"}
          </Text>
        </PressFeedback>
      )}
    </Pressable>
  );
}

function LinkedIncidentColumn(props: {
  eventId: number;
  incidentNumber: number;
  reportEntries: JournalEntry[];
  edit: ReportPaneProps["edit"];
  mayLink: boolean;
}) {
  const { eventId, incidentNumber, reportEntries, edit, mayLink } = props;
  const eventName = useEventName(eventId);
  const query = useIncident(eventId, incidentNumber);
  const error = query.error ? toAppError(query.error) : undefined;

  return (
    <Box p="lg" gap="md" style={styles.fill} testID="companion-linked">
      <Box row align="center" justify="space-between">
        <Text variant="heading">{`Incident #${incidentNumber}`}</Text>
        {mayLink ? (
          <TextButton
            label="Detach"
            onPress={() => {
              void edit.setIncident(0).catch(() => {});
            }}
            testID="companion-detach"
          />
        ) : null}
      </Box>
      {query.isLoading ? (
        <LoadingState />
      ) : error?.kind === "notFound" ? (
        <Text color="textMuted" testID="companion-not-visible">
          Not visible to you
        </Text>
      ) : error ? (
        <ErrorState error={error} onRetry={query.refetch} />
      ) : query.data?.incident?.incident ? (
        <IncidentExcerpt
          incident={query.data.incident.incident}
          reportEntries={reportEntries}
          eventName={eventName}
        />
      ) : null}
    </Box>
  );
}

function IncidentExcerpt(props: {
  incident: Incident;
  reportEntries: JournalEntry[];
  eventName: string;
}) {
  const { incident, reportEntries, eventName } = props;
  const state = stateLabel(incident.state);
  const priority = priorityLabel(incident.priority);
  const times = reportEntries.map(timeOf).filter((t) => t > 0);
  const windowMs = 60 * 60 * 1000;
  const min = times.length > 0 ? Math.min(...times) - windowMs : undefined;
  const max = times.length > 0 ? Math.max(...times) + windowMs : undefined;
  const entries = incident.journalEntries
    .filter((e) => {
      if (min === undefined || max === undefined) {
        return true;
      }
      const t = timeOf(e);
      return t >= min && t <= max;
    })
    .slice()
    .sort((a, b) => timeOf(a) - timeOf(b));

  return (
    <Box gap="md" flex={1}>
      <Text>{incident.summary || "(no summary)"}</Text>
      <Box row align="center" gap="sm" style={styles.badgeRow}>
        <Badge label={state?.label ?? "Open"} tone={state?.tone ?? "info"} />
        <Badge
          label={priority?.label ?? "Normal"}
          tone={priority?.tone ?? "neutral"}
        />
        <Badge
          label={incident.location?.areaSlug ?? "No area"}
          tone="neutral"
        />
      </Box>
      <Text variant="caption" color="textMuted">
        {`As of ${formatTimestamp(incident.lastModified)}`}
      </Text>
      {entries.length === 0 ? (
        <Text color="textMuted">No overlapping entries.</Text>
      ) : (
        entries.map((entry) => (
          <JournalEntryRow
            key={entry.id}
            entry={entry}
            attachmentOn={{ eventName, incidentNumber: incident.number }}
          />
        ))
      )}
    </Box>
  );
}
