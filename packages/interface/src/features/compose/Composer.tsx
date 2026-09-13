// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { RefObject } from "react";
import { useState } from "react";
import type { TextInput } from "react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { useMentionSearch } from "@/features/compose/hooks";
import {
  insertMention,
  mentionQuery,
  type Picked,
  tokenFor,
} from "@/features/compose/mentions";

// The entry composer (plan 09r): a multi-line field with the `@` typeahead
// over ListPersonnel. The result list does not animate in. The composer owns
// the caret — the trigger is a function of the text UP TO the caret.

export interface ComposerProps {
  eventId: number;
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  picked: Picked[];
  onPicked: (picked: Picked[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Lines the box shows at rest. */
  rows?: number;
  error?: string;
  onBlur?: () => void;
  testID?: string;
  /** Imperative focus (plan 09x criterion 8: the keyboard map's `a`). */
  inputRef?: RefObject<TextInput | null>;
}

export function Composer(props: ComposerProps) {
  const { eventId, value, onChangeText, picked, onPicked } = props;
  const theme = useTheme();
  const [caret, setCaret] = useState(0);
  const query = mentionQuery(value, caret);
  const matches = useMentionSearch(eventId, query?.query ?? "");

  const pick = (person: Person) => {
    const token = tokenFor(person);
    const next = insertMention(value, caret, token);
    onChangeText(next.text);
    onPicked([...picked, { personId: person.personId, token }]);
    setCaret(next.caret);
  };

  const lineHeight = theme.type.body.lineHeight ?? 20;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Field
        ref={props.inputRef}
        label={props.label}
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
        onBlur={props.onBlur}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        error={props.error}
        multiline
        testID={props.testID}
        style={{
          minHeight: (props.rows ?? 3) * lineHeight + theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          textAlignVertical: "top",
        }}
      />
      {query && matches.length > 0 ? (
        <View
          accessibilityRole="list"
          testID="mention-results"
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
              accessibilityLabel={`Mention ${p.handle || p.name}`}
              onPress={() => pick(p)}
              pressRetentionOffset={pressRetentionOffset}
              testID={`mention-${p.personId}`}
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

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
