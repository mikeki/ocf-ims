// SPDX-License-Identifier: Apache-2.0

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { SegmentedControl } from "@/features/board/SegmentedControl";
import { WorkRow } from "@/features/board/WorkRow";
import {
  newestFirst,
  toIncidentItem,
  type WorkItem,
} from "@/features/board/work";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { areaName, typeName } from "@/features/incidents/lookups";
import { EmptyState } from "@/features/shell/EmptyState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import {
  formatTimestamp,
  personLabel,
  priorityLabel,
  stateLabel,
} from "@/lib/format";
import { EVENT_NAME, ME } from "@/prototypes/d2/data";

// Stand-ins for the shipped Board and incident screens, with slots where a
// variant puts its entry point and its composer. They render the real rows.

type SegmentKey = "all" | "mine" | "reports";

export interface MiniBoardProps {
  incidents: IncidentView[];
  areas: Area[];
  onOpen: (number: number) => void;
  right?: ReactNode;
  /** Docked under the list. */
  footer?: ReactNode;
}

export function MiniBoard(props: MiniBoardProps) {
  const [segment, setSegment] = useState<SegmentKey>("mine");
  const resolve = (slug: string) => areaName(props.areas, slug) ?? slug;
  const all = props.incidents
    .map((view) => toIncidentItem(view, ME, resolve))
    .filter((item): item is WorkItem => item !== undefined)
    .sort(newestFirst);
  const mine = all.filter((item) => item.mine);
  const items = segment === "all" ? all : segment === "mine" ? mine : [];

  return (
    <Box flex={1} bg="background">
      <ScreenHeader
        title="Board"
        back={{ label: "Events", onPress: () => undefined }}
        right={
          props.right ?? (
            <Text variant="label" color="textMuted">
              {EVENT_NAME}
            </Text>
          )
        }
      />
      <SegmentedControl
        segments={[
          { key: "all", label: "All" },
          { key: "mine", label: "Mine", count: 2 },
          { key: "reports", label: "Reports" },
        ]}
        current={segment}
        onSelect={setSegment}
      />
      {items.length === 0 ? (
        <EmptyState title="No reports" message="Nothing has been reported." />
      ) : (
        <FlatList
          style={styles.fill}
          data={items}
          keyExtractor={(item) => `${item.kind}-${item.number}`}
          renderItem={({ item }) => (
            <WorkRow
              item={item}
              unread={item.number === 214 || item.number === 198}
              showOwnership={segment === "all"}
              onPress={() => props.onOpen(item.number)}
            />
          )}
        />
      )}
      {props.footer}
    </Box>
  );
}

export interface MiniIncidentProps {
  view: IncidentView;
  areas: Area[];
  types: IncidentType[];
  onBack: () => void;
  right?: ReactNode;
  /** Rendered after the journal, inside the scroll. */
  afterJournal?: ReactNode;
  /** Docked under the scroll, above the keyboard. */
  footer?: ReactNode;
}

export function MiniIncident(props: MiniIncidentProps) {
  const { view, areas, types } = props;
  const theme = useTheme();
  const incident = view.incident;
  if (!incident) {
    return null;
  }
  const state = stateLabel(incident.state);
  const priority = priorityLabel(incident.priority);
  const entries = incident.journalEntries
    .filter((e) => !e.systemEntry)
    .slice()
    .sort((a, b) => timeOf(a.created) - timeOf(b.created));
  const where = [
    incident.location?.areaSlug
      ? areaName(areas, incident.location.areaSlug)
      : undefined,
    incident.location?.description,
    incident.location?.booth ? `Booth ${incident.location.booth}` : undefined,
  ].filter((p): p is string => Boolean(p));
  const typeNames = incident.incidentTypeIds.map((id) => typeName(types, id));

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Box flex={1} bg="background">
        <ScreenHeader
          title={`#${incident.number}`}
          back={{ label: "Board", onPress: props.onBack }}
          right={props.right}
        />
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled">
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
              <Text variant="heading">
                {incident.summary || "(no summary)"}
              </Text>
            </Box>
            <Box
              bg="surface"
              radius="lg"
              p="lg"
              gap="xs"
              style={{ borderWidth: 1, borderColor: theme.colors.border }}
            >
              <Text variant="caption" color="textMuted">
                {`Created ${formatTimestamp(incident.created)} by ${personLabel(incident.createdBy)}`}
              </Text>
              <Text variant="caption" color="textMuted">
                {where.length > 0 ? where.join(" · ") : "No location"}
              </Text>
              <Text variant="caption" color="textMuted">
                {typeNames.length > 0 ? typeNames.join(", ") : "No type"}
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
            {props.afterJournal}
          </Box>
        </ScrollView>
        {props.footer}
      </Box>
    </KeyboardAvoidingView>
  );
}

/** A docked panel: surface, ruled off the content above it. */
export function Dock(props: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={props.testID}
      style={[
        styles.dock,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
        },
      ]}
    >
      {props.children}
    </View>
  );
}

/** A full-screen step or form: header plus a scrolling body. */
export function FormScreen(props: {
  title: string;
  back: { label: string; onPress: () => void };
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Box flex={1} bg="background">
        <ScreenHeader
          title={props.title}
          back={props.back}
          right={props.right}
        />
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled">
          <Box p="lg" gap="lg">
            {props.children}
          </Box>
        </ScrollView>
        {props.footer}
      </Box>
    </KeyboardAvoidingView>
  );
}

function timeOf(ts: Timestamp | undefined): number {
  return ts ? timestampDate(ts).getTime() : 0;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
