// SPDX-License-Identifier: Apache-2.0

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import type { ReactNode } from "react";
import { useState } from "react";
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
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { owesReport } from "@/features/board/work";
import { AppendComposer } from "@/features/compose/AppendComposer";
import { useEventAccess, useEventName } from "@/features/events/hooks";
import {
  useAreas,
  useIncident,
  useIncidentTypes,
} from "@/features/incidents/hooks";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { areaName, typeName } from "@/features/incidents/lookups";
import { PeopleSection } from "@/features/incidents/PeopleSection";
import { useLiveEvent } from "@/features/live/useLiveEvent";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import {
  formatTimestamp,
  personLabel,
  priorityLabel,
  stateLabel,
} from "@/lib/format";
import { useSession } from "@/session/provider";

// The incident detail (plan 09n): every read-only section from the journal
// down, pull-to-refresh, and the system-entries toggle, plus the docked
// composer when the caller may add to the journal (09r). Navigation
// (linked-incident presses, back) is the route's job (T6) — this component
// takes ids and callbacks only.

export interface IncidentScreenProps {
  eventId: number;
  number: number;
  onBack: () => void;
  onOpenIncident: (number: number) => void;
  onOpenReport: (number: number) => void;
  /** Open the report form with this incident set (09t). */
  onFileReport: () => void;
  /** Open an entry's image full-width (09s). */
  onOpenAttachment: (entryId: number) => void;
}

export function IncidentScreen(props: IncidentScreenProps) {
  const {
    eventId,
    number,
    onBack,
    onOpenIncident,
    onOpenReport,
    onFileReport,
    onOpenAttachment,
  } = props;
  const theme = useTheme();
  const access = useEventAccess(eventId);
  const eventName = useEventName(eventId);
  const { state } = useSession();
  const incidentQuery = useIncident(eventId, number);
  useLiveEvent(eventId);
  const areasQuery = useAreas(eventId, access.readAreas);
  const typesQuery = useIncidentTypes();
  const view = incidentQuery.data?.incident;
  const mayAppend = view?.viewerMayAddJournal === true;
  const author = state.status === "signedIn" ? state.auth.user : "";
  const me = state.status === "signedIn" ? state.auth.personId : 0;
  const owed = view !== undefined && owesReport(view, me);

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Box flex={1} bg="background">
        <ScreenHeader
          title={`#${number}`}
          back={{ label: "Board", onPress: onBack }}
        />
        {renderBody({
          incidentQuery,
          areas: areasQuery.data?.areas,
          types: typesQuery.data?.incidentTypes,
          eventId,
          eventName,
          number,
          mayAsk: access.writeIncidents,
          onBack,
          onOpenIncident,
          onOpenReport,
          onOpenAttachment,
        })}
        {owed ? (
          <View
            style={[
              styles.dock,
              {
                backgroundColor: theme.colors.surface,
                borderTopColor: theme.colors.border,
                padding: theme.spacing.md,
              },
            ]}
          >
            <Button
              label="File your report"
              onPress={onFileReport}
              testID="file-your-report"
            />
          </View>
        ) : null}
        {mayAppend ? (
          <AppendComposer
            eventId={eventId}
            number={number}
            author={author}
            eventName={eventName}
            attachFiles={access.attachFiles && eventName !== ""}
          />
        ) : null}
      </Box>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: { borderTopWidth: StyleSheet.hairlineWidth },
});

interface BodyArgs {
  incidentQuery: ReturnType<typeof useIncident>;
  areas: Area[] | undefined;
  types: IncidentType[] | undefined;
  eventId: number;
  eventName: string;
  number: number;
  mayAsk: boolean;
  onBack: () => void;
  onOpenIncident: (number: number) => void;
  onOpenReport: (number: number) => void;
  onOpenAttachment: (entryId: number) => void;
}

function renderBody(args: BodyArgs): ReactNode {
  const { incidentQuery, areas, types, number, onBack } = args;
  if (incidentQuery.isLoading) {
    return <LoadingState />;
  }
  if (incidentQuery.error) {
    const error = toAppError(incidentQuery.error);
    if (error.kind === "notFound") {
      return (
        <EmptyState
          title="Not found"
          message={`There's no incident #${number} here.`}
          action={{ label: "Back to incidents", onPress: onBack }}
        />
      );
    }
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void incidentQuery.refetch();
        }}
      />
    );
  }
  const view = incidentQuery.data?.incident;
  if (!view?.incident) {
    return null;
  }
  return (
    <IncidentDetail
      view={view}
      areas={areas}
      types={types}
      eventId={args.eventId}
      eventName={args.eventName}
      mayAsk={args.mayAsk}
      onOpenIncident={args.onOpenIncident}
      onOpenReport={args.onOpenReport}
      onOpenAttachment={args.onOpenAttachment}
      refreshing={incidentQuery.isRefetching && !incidentQuery.isLoading}
      onRefresh={() => {
        void incidentQuery.refetch();
      }}
    />
  );
}

interface IncidentDetailProps {
  view: IncidentView;
  areas: Area[] | undefined;
  types: IncidentType[] | undefined;
  eventId: number;
  eventName: string;
  mayAsk: boolean;
  onOpenIncident: (number: number) => void;
  onOpenReport: (number: number) => void;
  onOpenAttachment: (entryId: number) => void;
  refreshing: boolean;
  onRefresh: () => void;
}

function IncidentDetail(props: IncidentDetailProps) {
  const {
    view,
    areas,
    types,
    eventId,
    eventName,
    mayAsk,
    onOpenIncident,
    onOpenReport,
    onOpenAttachment,
    refreshing,
    onRefresh,
  } = props;
  const [showSystemEntries, setShowSystemEntries] = useState(false);
  const incident = view.incident;
  if (!incident) {
    return null;
  }

  const state = stateLabel(incident.state);
  const priority = priorityLabel(incident.priority);
  const typeNames =
    incident.incidentTypeIds.length > 0
      ? incident.incidentTypeIds.map((id) => typeName(types, id)).join(", ")
      : "None";
  const entries = incident.journalEntries
    .filter((e) => showSystemEntries || !e.systemEntry)
    .slice()
    .sort((a, b) => timeOf(a.created) - timeOf(b.created));

  return (
    <ScrollView
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          testID="incident-refresh-control"
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      }
    >
      <Box p="lg" gap="lg">
        <Box gap="sm">
          <Box row align="center" gap="sm">
            <Text variant="title" testID="incident-number">
              {`#${incident.number}`}
            </Text>
            {state ? <Badge label={state.label} tone={state.tone} /> : null}
            {priority ? (
              <Badge label={priority.label} tone={priority.tone} />
            ) : null}
            {incident.private ? (
              <Badge label="Private" tone="restricted" />
            ) : null}
          </Box>
          <Text variant="heading">{incident.summary || "(no summary)"}</Text>
        </Box>

        <Card>
          <Meta>{`Started ${formatTimestamp(incident.started)}`}</Meta>
          <Meta>
            {`Created ${formatTimestamp(incident.created)} by ${personLabel(incident.createdBy)}`}
          </Meta>
          <Meta>{`Last modified ${formatTimestamp(incident.lastModified)}`}</Meta>
          {incident.closed ? (
            <Meta>{`Closed ${formatTimestamp(incident.closed)}`}</Meta>
          ) : null}
        </Card>

        <Section title="Location">
          {locationParts(incident, areas).map((part) => (
            <Text key={part}>{part}</Text>
          ))}
        </Section>

        <Section title="Types">
          <Text>{typeNames}</Text>
        </Section>

        <Section title="People">
          <PeopleSection
            eventId={eventId}
            number={incident.number}
            people={incident.people}
            mayAsk={mayAsk}
            onOpenReport={onOpenReport}
          />
        </Section>

        {incident.linkedIncidents.length > 0 ? (
          <Section title="Linked incidents">
            {incident.linkedIncidents.map((ref) => (
              <TextButton
                key={ref.incidentNumber}
                label={`#${ref.incidentNumber}`}
                variant="figure"
                onPress={() => onOpenIncident(ref.incidentNumber)}
              />
            ))}
          </Section>
        ) : null}

        {incident.reports.length > 0 ? (
          <Section title="Reports">
            {incident.reports.map((n) => (
              <TextButton
                key={n}
                label={`Report #${n}`}
                onPress={() => onOpenReport(n)}
                testID={`incident-report-${n}`}
              />
            ))}
          </Section>
        ) : null}

        <Box gap="sm">
          <Box row align="center" justify="space-between" gap="md">
            <Text variant="heading">Journal</Text>
            <Box row align="center" gap="sm">
              <Text variant="label" color="textMuted">
                Show system entries
              </Text>
              <Switch
                accessibilityLabel="Show system entries"
                value={showSystemEntries}
                onValueChange={setShowSystemEntries}
              />
            </Box>
          </Box>
          {entries.length === 0 ? (
            <Text color="textMuted">No entries yet.</Text>
          ) : (
            entries.map((entry) => (
              <JournalEntryRow
                key={entry.id}
                entry={entry}
                attachmentOn={{ eventName, incidentNumber: incident.number }}
                onOpenAttachment={onOpenAttachment}
              />
            ))
          )}
        </Box>
      </Box>
    </ScrollView>
  );
}

/** A block of related read-only content: a surface, ruled off the page. */
function Card(props: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Box
      bg="surface"
      radius="lg"
      p="lg"
      gap="xs"
      style={{ borderWidth: 1, borderColor: theme.colors.border }}
    >
      {props.children}
    </Box>
  );
}

/** A timestamp line. Captions are tabular, so the four of them align. */
function Meta(props: { children: ReactNode }) {
  return (
    <Text variant="caption" color="textMuted">
      {props.children}
    </Text>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <Box gap="sm">
      <Text variant="heading">{props.title}</Text>
      <Card>{props.children}</Card>
    </Box>
  );
}

/** One line per part: an area, a description, a booth — never a dotted string. */
function locationParts(
  incident: Incident,
  areas: Area[] | undefined,
): string[] {
  const parts: string[] = [];
  const slug = incident.location?.areaSlug;
  if (slug) {
    parts.push(areaName(areas, slug) ?? slug);
  }
  if (incident.location?.description) {
    parts.push(incident.location.description);
  }
  if (incident.location?.booth) {
    parts.push(`Booth ${incident.location.booth}`);
  }
  return parts.length > 0 ? parts : ["No location"];
}

function timeOf(ts: Timestamp | undefined): number {
  return ts ? timestampDate(ts).getTime() : 0;
}
