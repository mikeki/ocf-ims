// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";

// The Ledger's mechanism (plan 09y, the Ledger row): a value that is its own
// control. At rest the value renders as the read screen does, plus the one
// mark that says it is pressable — a dotted underline in `borderStrong` —
// and a press is a hard cut to the control; when the control is done (a
// save settled, an unchanged blur) it is a hard cut back. A reader sees the
// value without the underline and without the press.

export interface InPlaceProps {
  /** The control is reachable. */
  enabled: boolean;
  value: (edit: () => void) => ReactNode;
  control: (done: () => void) => ReactNode;
}

export function InPlace(props: InPlaceProps) {
  const [editing, setEditing] = useState(false);
  if (editing && props.enabled) {
    return <>{props.control(() => setEditing(false))}</>;
  }
  return <>{props.value(() => setEditing(true))}</>;
}

/** A control with a Done control beside it, for the pickers that have no natural blur. */
export function ControlWithDone(props: {
  children: ReactNode;
  onDone: () => void;
  label?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {props.children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.label ?? "Done"}
        onPress={props.onDone}
        pressRetentionOffset={pressRetentionOffset}
        style={styles.hug}
        testID="in-place-done"
      >
        {({ pressed }) => (
          <PressFeedback pressed={pressed}>
            <Text variant="label" color="primary">
              {props.label ?? "Done"}
            </Text>
          </PressFeedback>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hug: { alignSelf: "flex-start" },
});
