// SPDX-License-Identifier: Apache-2.0

import type { IncidentRef } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/incident_ref_pb";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Box } from "@/design/primitives/Box";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { FieldError } from "@/features/incidents/controls/bits";
import {
  type EventName,
  parseLinks,
} from "@/features/incidents/controls/fields";
import type { EditIncident } from "@/features/incidents/useEditIncident";

// Linked incidents (plan 09y): one row per link — the number opens it when
// it is this event's, the other event's name sits beside it otherwise — and
// Unlink; the add field takes templ's `1`, `3,4,5`, `2015#2`. The whole list
// goes on the wire each time.

export interface LinksEditorProps {
  eventId: number;
  links: IncidentRef[];
  events: EventName[];
  mayEdit: boolean;
  edit: EditIncident;
  onOpenIncident: (number: number) => void;
  /** Controlled: the add field is open. Undefined = the editor owns the add word. */
  adding?: boolean;
  onAddingChange?: (adding: boolean) => void;
  /** Ledger: the add field appears on press. */
  inPlace?: boolean;
}

export function LinksEditor(props: LinksEditorProps) {
  const { eventId, links, events, mayEdit, edit, onOpenIncident, inPlace } =
    props;
  const theme = useTheme();
  const [text, setText] = useState("");
  const [ownAdding, setOwnAdding] = useState(false);
  const controlled = props.adding !== undefined;
  const adding = controlled ? props.adding === true : ownAdding;
  const setAdding = (v: boolean) => {
    setOwnAdding(v);
    props.onAddingChange?.(v);
  };
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const status = edit.status("links");

  const current = links.map((l) => ({
    eventId: l.eventId,
    incidentNumber: l.incidentNumber,
  }));

  const add = () => {
    const parsed = parseLinks(text, events, eventId);
    if (parsed.error !== undefined) {
      setProblem(parsed.error);
      return;
    }
    setProblem(undefined);
    const merged = [...current];
    for (const link of parsed.links) {
      if (
        !merged.some(
          (m) =>
            m.eventId === link.eventId &&
            m.incidentNumber === link.incidentNumber,
        )
      ) {
        merged.push(link);
      }
    }
    setText("");
    setAdding(false);
    void edit.setLinks(merged).catch(() => {});
  };

  const remove = (ref: IncidentRef) => {
    void edit
      .setLinks(
        current.filter(
          (l) =>
            !(
              l.eventId === ref.eventId &&
              l.incidentNumber === ref.incidentNumber
            ),
        ),
      )
      .catch(() => {});
  };

  return (
    <Box gap="sm">
      {controlled && mayEdit && adding ? (
        <Field
          label="Link incidents"
          value={text}
          onChangeText={(t) => {
            setText(t);
            setProblem(undefined);
          }}
          onSubmitEditing={add}
          onBlur={() => {
            if (text.trim() === "") {
              setAdding(false);
            }
          }}
          blurOnSubmit={false}
          autoFocus={inPlace}
          placeholder="12, 15 or OCF 2025#118, then Enter"
          error={problem}
          autoCapitalize="none"
          autoCorrect={false}
          testID="links-add"
        />
      ) : null}
      {links.length === 0 ? (
        <Text color="textMuted">No linked incidents</Text>
      ) : (
        links.map((ref, idx) => (
          <View
            key={`${ref.eventId}-${ref.incidentNumber}`}
            style={[
              styles.row,
              {
                gap: theme.spacing.sm,
                borderBottomColor: theme.colors.border,
                paddingBottom: idx < links.length - 1 ? theme.spacing.sm : 0,
                borderBottomWidth:
                  idx < links.length - 1 ? StyleSheet.hairlineWidth : 0,
              },
            ]}
          >
            <View style={[styles.body, { gap: theme.spacing.xs }]}>
              <Box row align="center" gap="sm">
                {ref.eventId === eventId ? (
                  <TextButton
                    label={`#${ref.incidentNumber}`}
                    variant="figure"
                    onPress={() => onOpenIncident(ref.incidentNumber)}
                  />
                ) : (
                  <Text variant="figure">{`${ref.eventName || `Event ${ref.eventId}`} #${ref.incidentNumber}`}</Text>
                )}
              </Box>
              {ref.summary ? (
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {ref.summary}
                </Text>
              ) : null}
            </View>
            {mayEdit ? (
              <TextButton
                label="Unlink"
                onPress={() => remove(ref)}
                testID={`unlink-${ref.incidentNumber}`}
              />
            ) : null}
          </View>
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
          {!inPlace || adding ? (
            <Field
              label="Link incidents"
              value={text}
              onChangeText={(t) => {
                setText(t);
                setProblem(undefined);
              }}
              onSubmitEditing={add}
              onBlur={() => {
                if (text.trim() === "") {
                  setAdding(false);
                }
              }}
              blurOnSubmit={false}
              autoFocus={inPlace}
              placeholder="12, 15 or OCF 2025#118, then Enter"
              error={problem}
              autoCapitalize="none"
              autoCorrect={false}
              testID="links-add"
            />
          ) : (
            <TextButton
              label="Link an incident…"
              onPress={() => setAdding(true)}
              testID="links-add-open"
            />
          )}
        </View>
      ) : null}
      <FieldError error={status.error} />
    </Box>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  body: { flexShrink: 1, flexGrow: 1 },
});
