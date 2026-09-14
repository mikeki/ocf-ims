// SPDX-License-Identifier: Apache-2.0

import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import type { RefObject } from "react";
import { useImperativeHandle, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
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
import {
  AppendComposer,
  type AppendComposerHandle,
} from "@/features/compose/AppendComposer";
import { useEventName } from "@/features/events/hooks";
import { Card, Section } from "@/features/incidents/controls/bits";
import {
  AreaControl,
  areaLabel,
  BoothControl,
  DetailsControl,
  OutcomeControl,
  outcomeName,
  PriorityControl,
  PrivateControl,
  StartedControl,
  StateControl,
  SummaryControl,
  TypesControl,
} from "@/features/incidents/controls/Controls";
import {
  ControlWithDone,
  InPlace,
} from "@/features/incidents/controls/InPlace";
import { Journal } from "@/features/incidents/Journal";
import { LedgerRow } from "@/features/incidents/LedgerRow";
import { LinksEditor } from "@/features/incidents/LinksEditor";
import { PeopleEditor } from "@/features/incidents/PeopleEditor";
import { ReportsEditor } from "@/features/incidents/ReportsEditor";
import { useEditIncident } from "@/features/incidents/useEditIncident";
import { useEditorData } from "@/features/incidents/useEditorData";
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

// The incident editor, the Ledger (plan 09y): *in place* — the value is the
// control. Every read-only section from 09n's screen stays, in the same
// reading order, but for a writer each row is a hard cut to its field's
// control (LedgerRow) and the summary is the heading with an Edit word.
// Pull to refresh, the system-entries toggle and the docked composer are
// unchanged from the 3b screen; the composer moves to the top of the
// journal's entries (criterion 10), newest first.
//
// `chrome` (plan 09x criterion 8) lets the dispatch drawer and the full page
// embed this screen under their own header: "embedded" drops `ScreenHeader`
// and nothing else changes, so the phone (default "screen") is byte-for-byte
// unaffected. `handle` exposes what their keyboard map needs to reach in:
// `focusComposer` and `toggleSystemEntries`.

export interface IncidentScreenHandle {
  focusComposer(): void;
  toggleSystemEntries(): void;
}

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
  /** "embedded" (the drawer, the full page) drops the screen's own header. */
  chrome?: "screen" | "embedded";
  handle?: RefObject<IncidentScreenHandle | null>;
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
    chrome = "screen",
    handle,
  } = props;
  const theme = useTheme();
  const eventName = useEventName(eventId);
  const data = useEditorData(eventId, number);
  const edit = useEditIncident(eventId, number);
  useLiveEvent(eventId);
  const owed = data.view !== undefined && owesReport(data.view, data.gates.me);
  const [showSystemEntries, setShowSystemEntries] = useState(false);
  const composerRef = useRef<AppendComposerHandle>(null);
  useImperativeHandle(
    handle,
    () => ({
      focusComposer: () => composerRef.current?.focus(),
      toggleSystemEntries: () => setShowSystemEntries((v) => !v),
    }),
    [],
  );

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Box flex={1} bg="background">
        {chrome === "screen" ? (
          <ScreenHeader
            title={`#${number}`}
            back={{ label: "Board", onPress: onBack }}
          />
        ) : null}
        {renderBody({
          data,
          edit,
          eventId,
          eventName,
          number,
          onBack,
          onOpenIncident,
          onOpenReport,
          onOpenAttachment,
          showSystemEntries,
          onToggleSystemEntries: setShowSystemEntries,
          composerRef,
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
      </Box>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: { borderTopWidth: StyleSheet.hairlineWidth },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  shrink: { flexShrink: 1 },
});

interface BodyArgs {
  data: ReturnType<typeof useEditorData>;
  edit: ReturnType<typeof useEditIncident>;
  eventId: number;
  eventName: string;
  number: number;
  onBack: () => void;
  onOpenIncident: (number: number) => void;
  onOpenReport: (number: number) => void;
  onOpenAttachment: (entryId: number) => void;
  showSystemEntries: boolean;
  onToggleSystemEntries: (value: boolean) => void;
  composerRef: RefObject<AppendComposerHandle | null>;
}

function renderBody(args: BodyArgs) {
  const { data, number, onBack } = args;
  if (data.incidentQuery.isLoading) {
    return <LoadingState />;
  }
  if (data.incidentQuery.error) {
    const error = toAppError(data.incidentQuery.error);
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
          void data.incidentQuery.refetch();
        }}
      />
    );
  }
  if (!data.view?.incident) {
    return null;
  }
  // Keyed by the incident: Prev / Next update the number in place, and an
  // open row or a half-typed field must not carry over to the next incident.
  return (
    <IncidentDetail
      key={args.number}
      {...args}
      view={data.view}
      refreshing={
        data.incidentQuery.isRefetching && !data.incidentQuery.isLoading
      }
      onRefresh={() => {
        void data.incidentQuery.refetch();
      }}
    />
  );
}

interface IncidentDetailProps extends BodyArgs {
  view: IncidentView;
  refreshing: boolean;
  onRefresh: () => void;
}

function IncidentDetail(props: IncidentDetailProps) {
  const {
    data,
    edit,
    eventId,
    eventName,
    number,
    onOpenIncident,
    onOpenReport,
    onOpenAttachment,
    refreshing,
    onRefresh,
    showSystemEntries,
    onToggleSystemEntries,
    composerRef,
  } = props;
  const theme = useTheme();
  const [addingPerson, setAddingPerson] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [addingReport, setAddingReport] = useState(false);
  const incident = props.view.incident;
  if (!incident) {
    return null;
  }
  const may = data.gates.writeIncidents;
  const state = stateLabel(incident.state);
  const priority = priorityLabel(incident.priority);
  const control = { data, edit, eventId };
  const outcome = outcomeName(control);
  const area = areaLabel(control);
  const typeNames = incident.incidentTypeIds.map(
    (id) => data.lookups.types?.find((t) => t.id === id)?.name ?? `Type #${id}`,
  );

  return (
    <ScrollView
      style={styles.fill}
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
          <Box row align="center" gap="sm" style={styles.wrap}>
            <Text variant="title" testID="incident-number">
              {`#${incident.number}`}
            </Text>
            <Badge
              label={state?.label ?? "Open"}
              tone={state?.tone ?? "info"}
            />
            {priority ? (
              <Badge label={priority.label} tone={priority.tone} />
            ) : null}
            {incident.private ? (
              <Badge label="Private" tone="restricted" />
            ) : null}
          </Box>
          <InPlace
            enabled={may}
            value={(edit_) => (
              <Box row align="flex-start" justify="space-between" gap="md">
                <Text
                  variant="heading"
                  color={incident.summary ? "text" : "textMuted"}
                  style={styles.shrink}
                  testID="summary-value"
                >
                  {incident.summary ||
                    (may ? "No summary yet" : "(no summary)")}
                </Text>
                {may ? (
                  <TextButton
                    label="Edit"
                    onPress={edit_}
                    testID="summary-edit"
                  />
                ) : null}
              </Box>
            )}
            control={(done) => (
              <SummaryControl {...control} onDone={done} autoFocus />
            )}
          />
        </Box>

        <Card testID="details-card">
          <LedgerRow
            label="State"
            may={may}
            testID="state-value"
            value={
              <Badge
                label={state?.label ?? "Open"}
                tone={state?.tone ?? "info"}
              />
            }
            control={(done) => <StateControl {...control} onDone={done} />}
          />
          <LedgerRow
            label="Priority"
            may={may}
            testID="priority-value"
            value={
              priority ? (
                <Badge label={priority.label} tone={priority.tone} />
              ) : (
                <Text>Normal</Text>
              )
            }
            control={(done) => <PriorityControl {...control} onDone={done} />}
          />
          <LedgerRow
            label="Private"
            may={may}
            testID="private-value"
            value={
              incident.private ? (
                <Badge label="Private" tone="restricted" />
              ) : (
                <Text>No</Text>
              )
            }
            control={(done) => (
              <ControlWithDone onDone={done}>
                <PrivateControl {...control} />
              </ControlWithDone>
            )}
          />
          <LedgerRow
            label="Outcome"
            may={may}
            testID="outcome-value"
            value={
              outcome ? (
                <Text>{outcome}</Text>
              ) : (
                <Text color="textMuted">{may ? "Add an outcome" : "None"}</Text>
              )
            }
            control={(done) => (
              <ControlWithDone onDone={done}>
                <OutcomeControl {...control} />
              </ControlWithDone>
            )}
          />
          <LedgerRow
            label="Started"
            may={may}
            testID="started-value"
            value={<Text>{formatTimestamp(incident.started)}</Text>}
            control={(done) => (
              <StartedControl {...control} onDone={done} autoFocus />
            )}
          />
          <LedgerRow
            label="Created"
            value={
              <Text color="textMuted">
                {`${formatTimestamp(incident.created)} by ${personLabel(incident.createdBy)}`}
              </Text>
            }
          />
          <LedgerRow
            label="Modified"
            value={
              <Text color="textMuted">
                {formatTimestamp(incident.lastModified)}
              </Text>
            }
          />
          {incident.closed ? (
            <LedgerRow
              label="Closed"
              value={
                <Text color="textMuted">
                  {formatTimestamp(incident.closed)}
                </Text>
              }
              last
            />
          ) : null}
        </Card>

        <Section title="Location">
          <LedgerRow
            label="Area"
            may={may}
            testID="area-value"
            value={
              area ? (
                <Text>{area}</Text>
              ) : (
                <Text color="textMuted">{may ? "Add an area" : "None"}</Text>
              )
            }
            control={(done) => (
              <ControlWithDone onDone={done}>
                <AreaControl {...control} onDone={done} />
              </ControlWithDone>
            )}
          />
          <LedgerRow
            label="Details"
            may={may}
            testID="details-value"
            value={
              incident.location?.description ? (
                <Text>{incident.location.description}</Text>
              ) : (
                <Text color="textMuted">
                  {may ? "Add location details" : "None"}
                </Text>
              )
            }
            control={(done) => (
              <DetailsControl {...control} onDone={done} autoFocus />
            )}
          />
          <LedgerRow
            label="Booth"
            may={may}
            testID="booth-value"
            value={
              incident.location?.booth ? (
                <Text>{incident.location.booth}</Text>
              ) : (
                <Text color="textMuted">{may ? "Add a booth" : "None"}</Text>
              )
            }
            control={(done) => (
              <BoothControl {...control} onDone={done} autoFocus />
            )}
            last
          />
        </Section>

        <Section title="Types">
          <LedgerRow
            label="Types"
            may={may}
            testID="types-value"
            value={
              typeNames.length === 0 ? (
                <Text color="textMuted">{may ? "Add a type" : "None"}</Text>
              ) : (
                <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
                  {typeNames.map((name) => (
                    <Badge key={name} label={name} tone="info" />
                  ))}
                </View>
              )
            }
            control={(done) => (
              <ControlWithDone onDone={done}>
                <TypesControl {...control} />
              </ControlWithDone>
            )}
            last
          />
        </Section>

        <Section
          title="People"
          right={
            may && !addingPerson ? (
              <TextButton
                label="Attach someone…"
                onPress={() => setAddingPerson(true)}
                testID="attach-someone-open"
              />
            ) : null
          }
        >
          <PeopleEditor
            eventId={eventId}
            number={incident.number}
            people={incident.people}
            mayEdit={may}
            edit={edit}
            onOpenReport={onOpenReport}
            adding={addingPerson}
            onAddingChange={setAddingPerson}
            inPlace
          />
        </Section>

        <Section
          title="Linked incidents"
          right={
            may && !addingLink ? (
              <TextButton
                label="Link an incident…"
                onPress={() => setAddingLink(true)}
                testID="links-add-open"
              />
            ) : null
          }
        >
          <LinksEditor
            eventId={eventId}
            links={incident.linkedIncidents}
            events={data.lookups.events}
            mayEdit={may}
            edit={edit}
            onOpenIncident={onOpenIncident}
            adding={addingLink}
            onAddingChange={setAddingLink}
            inPlace
          />
        </Section>

        <Section
          title="Reports"
          right={
            may && !addingReport ? (
              <TextButton
                label="Attach a report…"
                onPress={() => setAddingReport(true)}
                testID="reports-add-open"
              />
            ) : null
          }
        >
          <ReportsEditor
            reports={incident.reports}
            mayEdit={may}
            edit={edit}
            onOpenReport={onOpenReport}
            loaded={data.reportsLoaded}
            adding={addingReport}
            onAddingChange={setAddingReport}
            inPlace
          />
        </Section>

        <Journal
          items={data.journal}
          showSystem={showSystemEntries}
          onToggleSystem={onToggleSystemEntries}
          mayStrike={may}
          edit={edit}
          attachmentOn={{ eventName, incidentNumber: incident.number }}
          onOpenAttachment={onOpenAttachment}
          composer={
            data.gates.mayAppend ? (
              <AppendComposer
                ref={composerRef}
                eventId={eventId}
                number={number}
                author={data.gates.author}
                eventName={eventName}
                attachFiles={data.gates.attachFiles && eventName !== ""}
              />
            ) : null
          }
        />
      </Box>
    </ScrollView>
  );
}
