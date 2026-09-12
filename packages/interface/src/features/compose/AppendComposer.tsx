// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { type AppError, toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { Composer } from "@/features/compose/Composer";
import { useAppendEntry, useDraft } from "@/features/compose/hooks";
import { mentionedIds, type Picked } from "@/features/compose/mentions";

// The incident's docked composer (plan 09r, the D2 pick — Radio's bar): there
// whenever the caller may add to the journal. An entry lands optimistically;
// a failure keeps the text and says so beneath the box.

export interface AppendComposerProps {
  eventId: number;
  number: number;
  /** The caller's handle, for the optimistic entry. */
  author: string;
}

export function AppendComposer(props: AppendComposerProps) {
  const { eventId, number, author } = props;
  const theme = useTheme();
  const draft = useDraft(eventId, number);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [error, setError] = useState<AppError | undefined>(undefined);
  const { append, isPending } = useAppendEntry(eventId, number, author);
  const text = draft.draft.text;

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    setError(undefined);
    try {
      await append({
        text: trimmed,
        mentionIds: mentionedIds(trimmed, picked),
      });
    } catch (e) {
      setError(toAppError(e));
      return;
    }
    setPicked([]);
    draft.clear();
  };

  return (
    <View
      testID="append-composer"
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
      <Composer
        eventId={eventId}
        label="Add to the journal"
        value={text}
        onChangeText={(value) => draft.update({ text: value })}
        onBlur={draft.flush}
        picked={picked}
        onPicked={setPicked}
        placeholder="@ to mention someone"
        rows={2}
        error={error ? `${error.title}. ${error.message}` : undefined}
        testID="append-text"
      />
      <Box row align="center" justify="space-between" gap="sm">
        <Text variant="caption" color="textMuted">
          {draft.restored ? "Restored an unsent entry" : `Posting as ${author}`}
        </Text>
        <View style={styles.button}>
          <Button
            label="Send"
            loading={isPending}
            disabled={text.trim().length === 0}
            onPress={() => {
              void send();
            }}
            testID="append-send"
          />
        </View>
      </Box>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { borderTopWidth: StyleSheet.hairlineWidth },
  button: { minWidth: 88 },
});
