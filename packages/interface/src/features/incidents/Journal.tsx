// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { Switch, View } from "react-native";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { FieldError } from "@/features/incidents/controls/bits";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import type { EditIncident } from "@/features/incidents/useEditIncident";
import type { JournalItem } from "@/features/incidents/useEditorData";

// The journal as the editor shows it (plan 09y decision 3, criterion 10):
// the incident's entries and the attached reports' interleaved by time,
// newest first, the composer docked at the top under the "Journal" heading
// and the system toggle; each report entry carries "Report #n" and, for a
// writer, the incident's own non-system entries carry Strike / Unstrike —
// both on `JournalEntryRow`'s header line, so the row keeps one shape.
// Nothing here animates.

export interface JournalProps {
  items: JournalItem[];
  showSystem: boolean;
  onToggleSystem: (value: boolean) => void;
  mayStrike: boolean;
  edit: EditIncident;
  attachmentOn: { eventName: string; incidentNumber: number };
  onOpenAttachment: (entryId: number) => void;
  /** Rendered under the header, before the entries. */
  composer?: ReactNode;
}

export function Journal(props: JournalProps) {
  const {
    items,
    showSystem,
    onToggleSystem,
    mayStrike,
    edit,
    attachmentOn,
    onOpenAttachment,
  } = props;
  const theme = useTheme();
  const status = edit.status("strike");
  const visible = items.filter((item) => showSystem || !item.entry.systemEntry);
  const ordered = [...visible].reverse();

  return (
    <Box gap="sm" testID="journal">
      <Box row align="center" justify="space-between" gap="md">
        <Text variant="heading">Journal</Text>
        <Box row align="center" gap="sm">
          <Text variant="label" color="textMuted">
            Show system entries
          </Text>
          <Switch
            accessibilityLabel="Show system entries"
            value={showSystem}
            onValueChange={onToggleSystem}
          />
        </Box>
      </Box>
      {props.composer ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.lg,
            overflow: "hidden",
          }}
        >
          {props.composer}
        </View>
      ) : null}
      {ordered.length === 0 ? (
        <Text color="textMuted">No entries yet.</Text>
      ) : (
        ordered.map((item) => (
          <JournalEntryRow
            key={`${item.report ?? "i"}-${item.entry.id}`}
            entry={item.entry}
            report={item.report}
            attachmentOn={item.report === undefined ? attachmentOn : undefined}
            onOpenAttachment={onOpenAttachment}
            onStrike={
              mayStrike && item.report === undefined && !item.entry.systemEntry
                ? () => {
                    void edit
                      .setStricken(item.entry.id, !item.entry.stricken)
                      .catch(() => {});
                  }
                : undefined
            }
          />
        ))
      )}
      <FieldError error={status.error} />
    </Box>
  );
}
