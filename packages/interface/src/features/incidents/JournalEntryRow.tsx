// SPDX-License-Identifier: Apache-2.0

import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { formatTimestamp, personLabel } from "@/lib/format";

// One entry in an incident's journal (plan 09n): author + timestamp, the
// text, and the system-entry / stricken / attachment / on-behalf-of
// decorations. The "Show system entries" switch that hides these by default
// lives on the screen, not here — this row just renders whatever it's given.

export interface JournalEntryRowProps {
  entry: JournalEntry;
}

export function JournalEntryRow(props: JournalEntryRowProps) {
  const { entry } = props;
  const muted = entry.systemEntry || entry.stricken === true;

  return (
    <Box gap="xs" py="sm">
      <Text variant="caption" color="textMuted">
        {`${entry.author} · ${formatTimestamp(entry.created)}`}
      </Text>
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
