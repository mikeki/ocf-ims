// SPDX-License-Identifier: Apache-2.0

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, type TextInput, View } from "react-native";
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
import { PhotoAttach } from "@/features/compose/PhotoAttach";
import { usePhotoUpload } from "@/features/compose/usePhotoUpload";
import { LedgerRow } from "@/features/incidents/LedgerRow";

// The report's docked composer (plan 09t; 09z § The data layer and the
// composer): "On behalf of" is its own `LedgerRow` at the top of the card, in
// the Ledger's `label · value · ›` language — a press hard-cuts to the
// PersonPicker in place. The pick is sticky per event for the session and
// clearing it reverts to the author. A photo (3b.4) uploads through the
// report route once the text entry has landed.
//
// Forwards a `ReportComposerHandle` (the pane's `a` focuses it from outside).

export interface ReportComposerHandle {
  focus(): void;
}

export interface ReportComposerProps {
  eventId: number;
  number: number;
  author: string;
  /** The event's name, for the attachment route; with `attachFiles`, shows the photo control. */
  eventName?: string;
  attachFiles?: boolean;
}

export const ReportComposer = forwardRef<
  ReportComposerHandle,
  ReportComposerProps
>(function ReportComposer(props, ref) {
  const { eventId, number, author, eventName = "", attachFiles } = props;
  const theme = useTheme();
  const draft = useDraft(eventId, `report-${number}`);
  const sticky = useOnBehalfOf(eventId);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [error, setError] = useState<AppError | undefined>(undefined);
  const { append, isPending } = useAppendReportEntry(eventId, number, author);
  const [sending, setSending] = useState(false);
  const photo = usePhotoUpload(eventId, eventName, { kind: "report" });
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(
    ref,
    () => ({ focus: () => inputRef.current?.focus() }),
    [],
  );
  const text = draft.draft.text;
  const canSend = text.trim().length > 0 || photo.pending !== undefined;

  // The text posts first (if any), then the photo; a failed photo keeps its
  // chip and Retry — the text, already posted, is not resent.
  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed && !photo.pending) {
      return;
    }
    setError(undefined);
    setSending(true);
    try {
      if (trimmed) {
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
      }
      await photo.upload(number);
    } finally {
      setSending(false);
    }
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
      {attachFiles ? (
        <PhotoAttach
          pending={photo.pending}
          onPicked={photo.pick}
          onClear={photo.clear}
          onRetry={() => {
            void photo.upload(number);
          }}
          busy={sending}
        />
      ) : null}
      <Composer
        inputRef={inputRef}
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
            loading={isPending || sending}
            disabled={!canSend}
            onPress={() => {
              void send();
            }}
            testID="report-append-send"
          />
        </View>
      </Box>
    </View>
  );
});

const styles = StyleSheet.create({
  dock: { borderTopWidth: StyleSheet.hairlineWidth },
  button: { minWidth: 88 },
});
