// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { ledger, pressRetentionOffset } from "@/design/tokens";
import { InPlace } from "@/features/incidents/controls/InPlace";

// The Ledger's row (plan 09y criterion 8): `label · value · ›` in one
// aligned column, `label` fixed to `ledger.labelWidth`. A writer's row is
// one `Pressable`; a press swaps the value column for the control in place,
// the label staying where it was — a hard cut, no animation — and `onDone`
// (a settled save, an unchanged blur, Done on the pickers, a same-value
// press) is the hard cut back. A reader's row has no chevron and is not
// pressable; nothing else differs.

export interface LedgerRowProps {
  label: string;
  value: ReactNode;
  /** Absent = a read-only row (Created, Modified, Closed). */
  control?: (done: () => void) => ReactNode;
  may?: boolean;
  last?: boolean;
  testID?: string;
}

export function LedgerRow(props: LedgerRowProps) {
  const { label, value, control, may = false, last = false } = props;
  const theme = useTheme();
  const rule = {
    borderBottomColor: theme.colors.border,
    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
  };
  const labelNode = (
    <View style={[styles.label, { paddingTop: theme.spacing.xs }]}>
      <Text variant="label" color="textMuted">
        {label}
      </Text>
    </View>
  );
  const editable = may && control !== undefined;

  return (
    <InPlace
      enabled={editable}
      value={(edit_) => {
        const body = (
          <View
            style={[
              styles.row,
              rule,
              { gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
            ]}
          >
            {labelNode}
            <View style={styles.value}>{value}</View>
            {editable ? (
              <Text variant="heading" color="textMuted" aria-hidden>
                ›
              </Text>
            ) : null}
          </View>
        );
        if (!editable) {
          return body;
        }
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${label.toLowerCase()}`}
            onPress={edit_}
            pressRetentionOffset={pressRetentionOffset}
            testID={props.testID}
          >
            {({ pressed }) => (
              <PressFeedback pressed={pressed}>{body}</PressFeedback>
            )}
          </Pressable>
        );
      }}
      control={(done) => (
        <View
          style={[
            styles.row,
            rule,
            { gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
          ]}
          testID={props.testID ? `${props.testID}-editing` : undefined}
        >
          {labelNode}
          <View style={styles.value}>{control?.(done)}</View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  label: { width: ledger.labelWidth, flexShrink: 0 },
  value: { flex: 1, minWidth: 0 },
});
