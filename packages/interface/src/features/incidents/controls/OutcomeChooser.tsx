// SPDX-License-Identifier: Apache-2.0

import type { Outcome } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/outcome_pb";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AppError } from "@/api/errors";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { Chip } from "@/features/compose/Chip";
import { FieldError } from "@/features/incidents/controls/bits";

// The outcome picker (plan 09y: new to the client): one of ListOutcomes as a
// chip, pressing the selected one clears (0 on the wire), and "Other" opens
// the propose-it field for a writer — the TypeChooser's shape, single-select.

export interface OutcomeChooserProps {
  outcomes: Outcome[] | undefined;
  selected: number | undefined;
  /** 0 clears. */
  onSelect: (id: number) => void;
  onPropose: (name: string) => Promise<number>;
  canPropose: boolean;
  disabled?: boolean;
  error?: AppError;
}

const PROPOSE_MIN = 2;

export function OutcomeChooser(props: OutcomeChooserProps) {
  const { selected, onSelect, onPropose, canPropose, disabled = false } = props;
  const theme = useTheme();
  const [prompting, setPrompting] = useState(false);
  const [name, setName] = useState("");
  const [proposing, setProposing] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const outcomes = (props.outcomes ?? []).filter(
    (o) => !o.hidden || o.id === selected,
  );
  const q = name.trim();
  const exact = outcomes.some(
    (o) => (o.name ?? "").trim().toLowerCase() === q.toLowerCase(),
  );

  const propose = async () => {
    setProposing(true);
    setProblem(undefined);
    try {
      const id = await onPropose(q);
      onSelect(id);
      setName("");
      setPrompting(false);
    } catch {
      setProblem("Couldn't propose that outcome. Try again.");
    } finally {
      setProposing(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm, opacity: disabled ? 0.6 : 1 }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Outcome"
        style={[styles.wrap, { gap: theme.spacing.sm }]}
      >
        {outcomes.map((o) => (
          <Chip
            key={o.id}
            label={o.name ?? `Outcome #${o.id}`}
            tone="success"
            selected={o.id === selected}
            onPress={() => {
              if (!disabled) {
                onSelect(o.id === selected ? 0 : o.id);
              }
            }}
            testID={`outcome-${o.id}`}
          />
        ))}
        {canPropose && !disabled ? (
          <Chip
            label="Other"
            tone="neutral"
            selected={prompting}
            onPress={() => setPrompting((v) => !v)}
            testID="outcome-other"
          />
        ) : null}
      </View>
      {prompting ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Field
            label="New outcome"
            value={name}
            onChangeText={setName}
            placeholder="Name the outcome"
            autoFocus
            error={problem}
            testID="outcome-propose-name"
          />
          {q.length >= PROPOSE_MIN && !exact ? (
            proposing ? (
              <Text variant="label" color="textMuted">
                Proposing…
              </Text>
            ) : (
              <TextButton
                label={`Propose “${q}” as a new outcome`}
                onPress={() => {
                  void propose();
                }}
                testID="outcome-propose"
              />
            )
          ) : null}
        </View>
      ) : null}
      <FieldError error={props.error} />
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
