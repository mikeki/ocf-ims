// SPDX-License-Identifier: Apache-2.0

import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import {
  formatTimestamp,
  personLabel,
  priorityLabel,
  stateLabel,
} from "@/lib/format";
import { access } from "@/prototypes/dispatch/data";
import { areaText, typesText } from "@/prototypes/dispatch/state";
import type { Dispatch } from "@/prototypes/dispatch/useDispatch";

// The incident as the three variants show it (plan 09x): the marks, the
// summary, the fields read-only, the journal, and a composer to give `a` a
// target. The editor is 3c.2's round; this pane exists so the round can
// judge how much width each shape leaves an incident, not what goes in it.

export interface IncidentPaneProps {
  d: Dispatch;
  incident: Incident;
  /** The back control; absent in Split, where the table is beside the pane. */
  back?: { label: string; onPress: () => void };
  /** Neighbours in the table's order, for the sequence affordances. */
  neighbours?: { prev?: number; next?: number };
  /** The drawer's way out to the full page. */
  onFull?: () => void;
}

export function IncidentPane(props: IncidentPaneProps) {
  const { d, incident, back, neighbours, onFull } = props;
  const theme = useTheme();
  const state = stateLabel(incident.state);
  const priority = priorityLabel(incident.priority);
  const entries = incident.journalEntries.filter(
    (entry) => d.showSystem || !entry.systemEntry,
  );
  const hidden = incident.journalEntries.length - entries.length;

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title={`#${incident.number}`}
        back={back}
        right={
          neighbours || onFull ? (
            <View style={[styles.row, { gap: theme.spacing.md }]}>
              {onFull ? (
                <TextButton label="Full page  ⏎" onPress={onFull} />
              ) : null}
              {neighbours?.prev !== undefined ? (
                <TextButton
                  label={`‹ #${neighbours.prev}`}
                  variant="figure"
                  onPress={() => d.open(neighbours?.prev ?? incident.number)}
                />
              ) : null}
              {neighbours?.next !== undefined ? (
                <TextButton
                  label={`#${neighbours.next} ›`}
                  variant="figure"
                  onPress={() => d.open(neighbours?.next ?? incident.number)}
                />
              ) : null}
            </View>
          ) : undefined
        }
      />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.lg,
        }}
      >
        <Box gap="sm">
          <View style={[styles.row, { gap: theme.spacing.xs }]}>
            {state ? <Badge label={state.label} tone={state.tone} /> : null}
            {priority ? (
              <Badge label={priority.label} tone={priority.tone} />
            ) : null}
            {incident.private ? (
              <Badge label="Private" tone="restricted" />
            ) : null}
          </View>
          <Text variant="title">{incident.summary ?? "(no summary)"}</Text>
        </Box>

        <Box
          bg="surface"
          radius="lg"
          p="md"
          gap="sm"
          style={{
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <Row label="Area" value={areaText(incident, d.lookups) || "—"} />
          <Row label="Type" value={typesText(incident, d.lookups) || "—"} />
          <Row label="Started" value={formatTimestamp(incident.started)} />
          <Row label="Created" value={formatTimestamp(incident.created)} />
          <Row label="Changed" value={formatTimestamp(incident.lastModified)} />
          <Row label="Reporter" value={personLabel(incident.createdBy)} />
          <Row
            label="People"
            value={
              incident.people.length
                ? incident.people
                    .map(
                      (p) =>
                        personLabel(p.person) +
                        (p.involvement ? ` (${p.involvement})` : ""),
                    )
                    .join(", ")
                : "—"
            }
          />
          <Text variant="caption" color="textMuted">
            Read-only here: the editor is 3c.2's round.
          </Text>
        </Box>

        <Box gap="sm">
          <View style={[styles.row, styles.between]}>
            <Text variant="heading">Journal</Text>
            <TextButton
              label={
                d.showSystem
                  ? "Hide system entries  h"
                  : hidden > 0
                    ? `Show ${hidden} system entries  h`
                    : "System entries  h"
              }
              onPress={d.toggleSystem}
            />
          </View>
          <Box
            bg="surface"
            radius="lg"
            style={{
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
            }}
          >
            {entries.map((entry) => (
              <JournalEntryRow key={entry.id} entry={entry} />
            ))}
          </Box>
        </Box>

        {access.writeIncidents ? (
          <Box gap="sm">
            <TextInput
              ref={d.composerRef}
              accessibilityLabel="Add an entry"
              placeholder="Add an entry…  a"
              placeholderTextColor={theme.colors.textMuted}
              multiline
              style={[
                styles.composer,
                theme.type.body,
                {
                  color: theme.colors.text,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.borderStrong,
                  borderRadius: theme.radii.md,
                  padding: theme.spacing.md,
                },
              ]}
              testID="dispatch-composer"
            />
            <View style={styles.hug}>
              <Button
                label="Add entry"
                variant="secondary"
                onPress={() =>
                  d.notify("Appending lands with the editor (3c.2)")
                }
              />
            </View>
          </Box>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row(props: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { gap: theme.spacing.md }]}>
      <View style={styles.label}>
        <Text variant="label" color="textMuted">
          {props.label}
        </Text>
      </View>
      <Text variant="body" style={styles.value}>
        {props.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  between: { justifyContent: "space-between" },
  label: { width: 72 },
  value: { flex: 1 },
  composer: {
    minHeight: 72,
    borderWidth: 1,
    outlineWidth: 0,
  },
  hug: { alignSelf: "flex-start" },
});
