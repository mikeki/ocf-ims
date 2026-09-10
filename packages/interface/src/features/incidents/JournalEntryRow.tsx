// SPDX-License-Identifier: Apache-2.0

import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { formatTimestamp, personLabel } from "@/lib/format";

// One entry in an incident's journal (plan 09n): author + timestamp, the
// text, and the system-entry / stricken / attachment / on-behalf-of
// decorations. The "Show system entries" switch that hides these by default
// lives on the screen, not here — this row just renders whatever it's given.
//
// A journal has to read like a log, so every entry hangs off a gutter rule
// (09o): full strength for something a person wrote, the decorative `border`
// for a system or stricken entry, which is the same recession its text takes.

export interface JournalEntryRowProps {
  entry: JournalEntry;
}

export function JournalEntryRow(props: JournalEntryRowProps) {
  const { entry } = props;
  const theme = useTheme();
  const muted = entry.systemEntry || entry.stricken === true;

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
      {entry.attachment ? (
        <Text variant="caption" color="textMuted">
          {`Attachment ${entry.attachment.id}`}
        </Text>
      ) : null}
      {entry.onBehalfOf ? (
        <Text variant="caption" color="textMuted">
          {`on behalf of ${personLabel(entry.onBehalfOf)}`}
        </Text>
      ) : null}
    </Box>
  );
}
