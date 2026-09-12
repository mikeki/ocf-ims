// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { useMentionSearch } from "@/features/compose/hooks";

// A one-person picker over ListPersonnel (plan 09t): a search field whose
// results are rows, and — once picked — the name with a way to clear it.
// The results do not animate in, like the mention typeahead they share.

export interface PersonPickerProps {
  eventId: number;
  label: string;
  placeholder?: string;
  picked?: { personId: number; label: string };
  onPick: (person: Person) => void;
  onClear: () => void;
  /** The words beside the name once picked; "on behalf of" by default. */
  pickedPrefix?: string;
  testID?: string;
}

export function PersonPicker(props: PersonPickerProps) {
  const { eventId, label, picked, onPick, onClear } = props;
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const matches = useMentionSearch(eventId, query);
  const testID = props.testID ?? "person-picker";

  if (picked) {
    return (
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="label" color="textMuted">
          {label}
        </Text>
        <View style={[styles.picked, { gap: theme.spacing.md }]}>
          <Text testID={`${testID}-picked`}>{picked.label}</Text>
          <View style={styles.center}>
            <TextButton
              label="Clear"
              onPress={() => {
                setQuery("");
                onClear();
              }}
              testID={`${testID}-clear`}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Field
        label={label}
        value={query}
        onChangeText={setQuery}
        placeholder={props.placeholder ?? "Type a name"}
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
      />
      {query.trim().length >= 2 && matches.length > 0 ? (
        <View
          accessibilityRole="list"
          testID={`${testID}-results`}
          style={{
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.borderStrong,
            borderWidth: 1,
            borderRadius: theme.radii.md,
            overflow: "hidden",
          }}
        >
          {matches.slice(0, 5).map((p) => (
            <Pressable
              key={p.personId}
              accessibilityRole="button"
              accessibilityLabel={`Pick ${p.handle || p.name}`}
              onPress={() => {
                setQuery("");
                onPick(p);
              }}
              pressRetentionOffset={pressRetentionOffset}
              testID={`${testID}-${p.personId}`}
            >
              {({ pressed }) => (
                <PressFeedback
                  pressed={pressed}
                  style={[
                    styles.row,
                    {
                      paddingHorizontal: theme.spacing.md,
                      gap: theme.spacing.sm,
                      borderBottomColor: theme.colors.border,
                    },
                  ]}
                >
                  <Text variant="label">{p.handle || p.name}</Text>
                  {p.handle && p.name ? (
                    <Text variant="caption" color="textMuted">
                      {p.name}
                    </Text>
                  ) : null}
                </PressFeedback>
              )}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** handle, else name, else the id: the label a pick carries. */
export function personPickLabel(person: Person): string {
  return person.handle || person.name || `Person #${person.personId}`;
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  picked: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
  },
  center: { justifyContent: "center" },
});
