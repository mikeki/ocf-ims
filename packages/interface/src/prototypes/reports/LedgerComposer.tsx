// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { type AppError, toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { Composer } from "@/features/compose/Composer";
import {
  useAppendReportEntry,
  useDraft,
  useOnBehalfOf,
} from "@/features/compose/hooks";
import { mentionedIds, type Picked } from "@/features/compose/mentions";
import { PersonPicker, personPickLabel } from "@/features/compose/PersonPicker";
import { LedgerRow } from "@/features/incidents/LedgerRow";

// Prototype variant (docs/plans/09z-reports-design.md, the round-2 ask):
// ReportComposer with "on behalf of" promoted from a footer caption to its
// own `LedgerRow` at the top of the card, in the Ledger's own
// `label · value · ›` language — a press hard-cuts to the PersonPicker in
// place (LedgerRow's own may+control mechanism), same as the incident's
// State / Priority rows. Everything else — the draft, the mentions, the
// append mutation — is untouched from the production composer.

export interface LedgerComposerProps {
  eventId: number;
  number: number;
  author: string;
}

export function LedgerComposer(props: LedgerComposerProps) {
  const { eventId, number, author } = props;
  const theme = useTheme();
  const draft = useDraft(eventId, `report-${number}`);
  const sticky = useOnBehalfOf(eventId);
  const [picked, setPicked] = useState<Picked[]>([]);
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

  const sendLabel = sticky.pick
    ? `Send for ${sticky.pick.label.split(" ")[0]}`
    : "Send";

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
      <LedgerRow
        label="On behalf of"
        may
        value={
          <Text>
            {sticky.pick ? sticky.pick.label : `Yourself (${author})`}
          </Text>
        }
        control={(done) => (
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
              done();
            }}
            onClear={() => {
              sticky.setPick(undefined);
              done();
            }}
            testID="composer-on-behalf-of"
          />
        )}
        testID="report-on-behalf-of-row"
      />
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
      <Box
        row
        align="center"
        justify={draft.restored ? "space-between" : "flex-end"}
        gap="sm"
      >
        {draft.restored ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            Restored an unsent entry
          </Text>
        ) : null}
        <View style={styles.button}>
          <Button
            label={sendLabel}
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
  button: { minWidth: 88 },
});
