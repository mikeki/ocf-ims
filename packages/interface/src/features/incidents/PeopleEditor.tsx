// SPDX-License-Identifier: Apache-2.0

import type { IncidentPerson } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { type AppError, toAppError } from "@/api/errors";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { Chip } from "@/features/compose/Chip";
import { useRequestReport } from "@/features/compose/hooks";
import { PersonPicker } from "@/features/compose/PersonPicker";
import { FieldError } from "@/features/incidents/controls/bits";
import { SavingField } from "@/features/incidents/SavingField";
import type { EditIncident } from "@/features/incidents/useEditIncident";
import { formatShortTime, personLabel } from "@/lib/format";

// The People editor (plan 09y): one block per attached person — the name,
// the involvement and access on a caption line, the report state, then the
// row's actions on one line (Involvement · Ask for a report · Detach) — and
// the 09t picker to attach someone. Two RPCs, one row each; the rows are
// optimistic on the list.
//
// The add control has two homes: inline (`adding` undefined — a word under
// the list behind a rule, as the Form and the Columns sheet draw it) or
// controlled by the caller (`adding` given — the Ledger puts the word in the
// section's header and the picker appears at the top of the list).

/** templ's involvement suggestions, offered as chips on an empty field. */
export const INVOLVEMENTS = [
  "Witness",
  "Reporting Party",
  "Subject",
  "Injured Party",
  "First Responder",
  "Staff",
  "Other",
] as const;

export interface PeopleEditorProps {
  eventId: number;
  number: number;
  people: IncidentPerson[];
  mayEdit: boolean;
  edit: EditIncident;
  onOpenReport: (number: number) => void;
  /** Controlled: the picker is open. Undefined = the editor owns the add word. */
  adding?: boolean;
  onAddingChange?: (adding: boolean) => void;
  /** Ledger: the involvement is a word until pressed; otherwise a field. */
  inPlace?: boolean;
}

export function PeopleEditor(props: PeopleEditorProps) {
  const { eventId, number, people, mayEdit, edit, onOpenReport, inPlace } =
    props;
  const theme = useTheme();
  const [ownAdding, setOwnAdding] = useState(false);
  const controlled = props.adding !== undefined;
  const adding = controlled ? props.adding === true : ownAdding;
  const setAdding = (v: boolean) => {
    setOwnAdding(v);
    props.onAddingChange?.(v);
  };
  const status = edit.status("people");
  const { request, isPending } = useRequestReport(eventId, number);
  const [askError, setAskError] = useState<AppError | undefined>(undefined);

  const ask = async (personId: number) => {
    setAskError(undefined);
    try {
      await request(personId);
    } catch (e) {
      setAskError(toAppError(e));
    }
  };

  const picker =
    mayEdit && adding ? (
      <PersonPicker
        eventId={eventId}
        label="Attach someone"
        placeholder="Type a name"
        onPick={(person) => {
          setAdding(false);
          void edit.attachPerson(person, undefined, false).catch(() => {});
        }}
        onClear={() => setAdding(false)}
        testID="attach-someone"
      />
    ) : null;

  return (
    <Box gap="md">
      {controlled ? picker : null}
      {people.length === 0 ? (
        <Text color="textMuted">No one attached</Text>
      ) : (
        people.map((p, idx) => (
          <PersonRow
            key={p.person?.personId ?? idx}
            person={p}
            last={idx === people.length - 1}
            mayEdit={mayEdit}
            edit={edit}
            inPlace={inPlace === true}
            onOpenReport={onOpenReport}
            onAsk={() => {
              void ask(p.person?.personId ?? 0);
            }}
            asking={isPending}
          />
        ))
      )}
      {!controlled && mayEdit ? (
        <View
          style={{
            paddingTop: theme.spacing.md,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
          }}
        >
          {adding ? (
            picker
          ) : (
            <TextButton
              label="Attach someone…"
              onPress={() => setAdding(true)}
              testID="attach-someone-open"
            />
          )}
        </View>
      ) : null}
      <FieldError error={status.error ?? askError} />
    </Box>
  );
}

interface PersonRowProps {
  person: IncidentPerson;
  last: boolean;
  mayEdit: boolean;
  edit: EditIncident;
  inPlace: boolean;
  onOpenReport: (number: number) => void;
  onAsk: () => void;
  asking: boolean;
}

function PersonRow(props: PersonRowProps) {
  const { person: p, last, mayEdit, edit, inPlace, onOpenReport } = props;
  const theme = useTheme();
  const personId = p.person?.personId ?? 0;
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const involvement = p.involvement ?? "";
  const showField = mayEdit && (!inPlace || editing);
  const access = p.hasEventAccess
    ? "Has event access"
    : p.grantedAccess
      ? "Granted access to this incident"
      : "No event access";

  const save = (value: string) =>
    edit.updatePerson(personId, value || undefined, p.grantedAccess);

  return (
    <View
      testID={`person-row-${personId}`}
      style={{
        gap: theme.spacing.xs,
        borderBottomColor: theme.colors.border,
        paddingBottom: last ? 0 : theme.spacing.md,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
      }}
    >
      <Text>{personLabel(p.person)}</Text>
      {showField ? (
        <View style={{ gap: theme.spacing.xs }}>
          <SavingField
            label="Involvement"
            value={involvement}
            placeholder="Witness, Reporting Party, …"
            maxLength={50}
            autoFocus={inPlace}
            onSave={save}
            onDone={() => setEditing(false)}
            onFocus={() => setFocused(true)}
            testID={`involvement-${personId}`}
          />
          {focused && involvement === "" ? (
            <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
              {INVOLVEMENTS.map((label) => (
                <Chip
                  key={label}
                  label={label}
                  tone="neutral"
                  selected={false}
                  onPress={() => {
                    setFocused(false);
                    void save(label)
                      .then(() => setEditing(false))
                      .catch(() => {});
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <Text variant="caption" color="textMuted">
          {involvement ? `${involvement} · ${access}` : access}
        </Text>
      )}
      {p.reportNumber ? (
        <Box row align="center" gap="sm">
          <Badge label="Report filed" tone="success" />
          <TextButton
            label={`R-${p.reportNumber}`}
            variant="figure"
            onPress={() => onOpenReport(p.reportNumber ?? 0)}
          />
        </Box>
      ) : p.reportRequested ? (
        <Box row align="center" gap="sm">
          <Badge label="Report requested" tone="warning" />
          <Text variant="caption" color="textMuted">
            {formatShortTime(p.reportRequested)}
          </Text>
        </Box>
      ) : null}
      {mayEdit && !p.hasEventAccess ? (
        <View style={[styles.grant, { gap: theme.spacing.sm }]}>
          <Switch
            accessibilityLabel={`Grant ${personLabel(p.person)} access to this incident`}
            value={p.grantedAccess}
            onValueChange={(value) => {
              void edit
                .updatePerson(personId, p.involvement, value)
                .catch(() => {});
            }}
            trackColor={{
              true: theme.colors.restricted,
              false: theme.colors.borderStrong,
            }}
            thumbColor={theme.colors.surface}
            testID={`grant-${personId}`}
          />
          <Text variant="caption" color="textMuted" style={styles.shrink}>
            Grant access to this incident
          </Text>
        </View>
      ) : null}
      {mayEdit ? (
        <View style={[styles.actions, { gap: theme.spacing.xl }]}>
          {inPlace && !editing ? (
            <TextButton
              label={involvement ? "Involvement" : "Add involvement"}
              onPress={() => setEditing(true)}
              testID={`involvement-open-${personId}`}
            />
          ) : null}
          {!p.reportNumber && personId ? (
            <TextButton
              label={
                props.asking
                  ? "Asking…"
                  : p.reportRequested
                    ? "Ask again"
                    : "Ask for a report"
              }
              onPress={props.onAsk}
              testID={`ask-report-${personId}`}
            />
          ) : null}
          <TextButton
            label="Detach"
            onPress={() => {
              void edit.detachPerson(personId).catch(() => {});
            }}
            testID={`detach-${personId}`}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  grant: { flexDirection: "row", alignItems: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  shrink: { flexShrink: 1 },
});
