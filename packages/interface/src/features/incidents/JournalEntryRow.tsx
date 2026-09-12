// SPDX-License-Identifier: Apache-2.0

import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { Image } from "expo-image";
import { Pressable, StyleSheet } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";
import { useAttachmentSource } from "@/features/incidents/useAttachmentSource";
import { formatTimestamp, personLabel } from "@/lib/format";

// One entry in an incident's journal (plan 09n): author + timestamp, the
// text, and the system-entry / stricken / attachment / on-behalf-of
// decorations. The "Show system entries" switch that hides these by default
// lives on the screen, not here — this row just renders whatever it's given.
//
// A journal has to read like a log, so every entry hangs off a gutter rule
// (09o): full strength for something a person wrote, the decorative `border`
// for a system or stricken entry, which is the same recession its text takes.
//
// An attachment whose media type is an image renders inline (09s), fetched
// with the session's Bearer; anything else is a file row, never a broken image.

export interface JournalEntryRowProps {
  entry: JournalEntry;
  /** Where the entry lives, for the attachment route; absent = no images (a report). */
  attachmentOn?: { eventName: string; incidentNumber: number };
  onOpenAttachment?: (entryId: number) => void;
}

/** The inline image's height: fixed, so the journal never reflows as images arrive. */
export const IMAGE_HEIGHT = 180;

export function JournalEntryRow(props: JournalEntryRowProps) {
  const { entry, attachmentOn, onOpenAttachment } = props;
  const theme = useTheme();
  const muted = entry.systemEntry || entry.stricken === true;
  const isImage =
    attachmentOn !== undefined &&
    entry.attachment?.mediaType?.startsWith("image/") === true;

  return (
    <Box
      gap="xs"
      py="sm"
      px="md"
      style={{
        borderLeftWidth: 2,
        borderLeftColor: muted
          ? theme.colors.border
          : theme.colors.borderStrong,
      }}
    >
      <Box row align="baseline" justify="space-between" gap="sm">
        <Text variant="label" color="textMuted" numberOfLines={1}>
          {entry.author}
        </Text>
        <Text variant="caption" color="textMuted">
          {formatTimestamp(entry.created)}
        </Text>
      </Box>
      <Text
        color={muted ? "textMuted" : "text"}
        style={
          entry.stricken ? { textDecorationLine: "line-through" } : undefined
        }
      >
        {entry.text}
      </Text>
      {entry.attachment && isImage && attachmentOn ? (
        <AttachedImage
          eventName={attachmentOn.eventName}
          incidentNumber={attachmentOn.incidentNumber}
          entryId={entry.id}
          name={entry.attachment.id}
          onPress={
            onOpenAttachment ? () => onOpenAttachment(entry.id) : undefined
          }
        />
      ) : entry.attachment ? (
        <Box gap="xs" testID={`attachment-file-${entry.id}`}>
          <Text variant="caption" color="textMuted">
            {`Attachment ${entry.attachment.id}`}
          </Text>
          {entry.attachment.mediaType ? (
            <Text variant="caption" color="textMuted">
              {entry.attachment.mediaType}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {entry.onBehalfOf ? (
        <Text variant="caption" color="textMuted">
          {`on behalf of ${personLabel(entry.onBehalfOf)}`}
        </Text>
      ) : null}
    </Box>
  );
}

function AttachedImage(props: {
  eventName: string;
  incidentNumber: number;
  entryId: number;
  name: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const source = useAttachmentSource(
    props.eventName,
    props.incidentNumber,
    props.entryId,
  );
  const image = (
    <Image
      testID={`attachment-image-${props.entryId}`}
      source={source}
      style={{
        height: IMAGE_HEIGHT,
        width: "100%",
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.textMuted,
      }}
      contentFit="cover"
      accessibilityLabel={`Photo ${props.name}`}
    />
  );
  if (!props.onPress) {
    return image;
  }
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={`Open photo ${props.name}`}
      onPress={props.onPress}
      pressRetentionOffset={pressRetentionOffset}
      testID={`attachment-open-${props.entryId}`}
    >
      {({ pressed }) => (
        <PressFeedback pressed={pressed} style={styles.fill}>
          {image}
        </PressFeedback>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { width: "100%" },
});
