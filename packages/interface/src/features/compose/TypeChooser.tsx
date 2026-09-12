// SPDX-License-Identifier: Apache-2.0

import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { Chip } from "@/features/compose/Chip";

// The incident-type picker on the filing form (plan 09r): chips filtered by
// a search field, "Other" pinned last as the type-your-own trigger, and the
// "propose it" offer for a name nothing matches — a writer's only.

export interface TypeChooserProps {
  types: IncidentType[] | undefined;
  selected: number[];
  onToggle: (id: number) => void;
  /** ProposeIncidentType; resolves to the id to attach (an existing one on a collision). */
  onPropose: (name: string) => Promise<number>;
  canPropose: boolean;
}

const OTHER = "Other";
const PROPOSE_MIN = 2;

export function TypeChooser(props: TypeChooserProps) {
  const { selected, onToggle, onPropose, canPropose } = props;
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [prompting, setPrompting] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const types = props.types ?? [];
  const q = query.trim().toLowerCase();
  const visible = types.filter(
    (t) =>
      !t.hidden &&
      (selected.includes(t.id) || (t.name ?? "").toLowerCase().includes(q)),
  );
  const exact = types.some(
    (t) => !t.hidden && (t.name ?? "").trim().toLowerCase() === q,
  );
  const offer = canPropose && q.length >= PROPOSE_MIN && !exact;

  const propose = async () => {
    setProposing(true);
    setError(undefined);
    try {
      const id = await onPropose(query.trim());
      if (!selected.includes(id)) {
        onToggle(id);
      }
      setQuery("");
    } catch {
      setError("Couldn't propose that type. Try again.");
    } finally {
      setProposing(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Field
        label="Type"
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setPrompting(false);
        }}
        placeholder={prompting ? "Type a new type name" : "Search types"}
        autoFocus={prompting}
        error={error}
        testID="type-search"
      />
      <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
        {visible.map((t) => (
          <Chip
            key={t.id}
            label={t.name ?? `Type #${t.id}`}
            selected={selected.includes(t.id)}
            onPress={() => onToggle(t.id)}
            testID={`type-${t.id}`}
          />
        ))}
        {!q || OTHER.toLowerCase().includes(q) ? (
          <Chip
            label={OTHER}
            tone="neutral"
            selected={false}
            onPress={() => {
              setQuery("");
              setPrompting(true);
            }}
            testID="type-other"
          />
        ) : null}
      </View>
      {offer ? (
        proposing ? (
          <Text variant="label" color="textMuted">
            Proposing…
          </Text>
        ) : (
          <TextButton
            label={`Propose “${query.trim()}” as a new type`}
            onPress={() => {
              void propose();
            }}
            testID="type-propose"
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
});
