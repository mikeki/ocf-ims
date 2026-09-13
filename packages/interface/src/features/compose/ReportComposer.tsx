// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { type AppError, toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { Composer } from "@/features/compose/Composer";
import {
  useAppendReportEntry,
  useDraft,
  useOnBehalfOf,
} from "@/features/compose/hooks";
import { mentionedIds, type Picked } from "@/features/compose/mentions";
import { PersonPicker, personPickLabel } from "@/features/compose/PersonPicker";

// The report's docked composer (plan 09t): the incident's composer with the
// "on behalf of" pick folded into its footer. The pick is sticky per event
// for the session and clearing it reverts to the author.

export interface ReportComposerProps {
  eventId: number;
  number: number;
  author: string;
}

export function ReportComposer(props: ReportComposerProps) {
  const { eventId, number, author } = props;
  const theme = useTheme();
  const draft = useDraft(eventId, `report-${number}`);
  const sticky = useOnBehalfOf(eventId);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<AppError | undefined>(undefined);
  const { append, isPending } = useAppendReportEntry(eventId, number, author);
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
        onBehalfOfId: sticky.pick?.personId,
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
      testID="report-composer"
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
      {choosing ? (
        <PersonPicker
          eventId={eventId}
          label="On behalf of"
          placeholder="Type a name, or clear for yourself"
          picked={sticky.pick}
          onPick={(person) => {
            sticky.setPick({
              personId: person.personId,
              label: personPickLabel(person),
            });
            setChoosing(false);
          }}
          onClear={() => {
            sticky.setPick(undefined);
            setChoosing(false);
          }}
          testID="composer-on-behalf-of"
        />
      ) : null}
      <Composer
        eventId={eventId}
        label="Add to the report"
        value={text}
        onChangeText={(value) => draft.update({ text: value })}
        onBlur={draft.flush}
        picked={picked}
        onPicked={setPicked}
        placeholder="@ to mention someone"
        rows={2}
        error={error ? `${error.title}. ${error.message}` : undefined}
        testID="report-append-text"
      />
      <Box row align="center" justify="space-between" gap="sm">
        <Box row align="center" gap="sm" style={styles.footer}>
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {draft.restored
              ? "Restored an unsent entry"
              : sticky.pick
                ? `On behalf of ${sticky.pick.label}`
                : `Posting as ${author}`}
          </Text>
          {!choosing ? (
            <TextButton
              label={sticky.pick ? "Change" : "For someone else"}
              onPress={() => setChoosing(true)}
              testID="report-on-behalf-of-toggle"
            />
          ) : null}
        </Box>
        <View style={styles.button}>
          <Button
            label="Send"
            loading={isPending}
            disabled={text.trim().length === 0}
            onPress={() => {
              void send();
            }}
            testID="report-append-send"
          />
        </View>
      </Box>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { borderTopWidth: StyleSheet.hairlineWidth },
  footer: { flexShrink: 1 },
  button: { minWidth: 88 },
});
