// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "@/design/primitives/Button";
import { Field } from "@/design/primitives/Field";
import { useTheme } from "@/design/theme";

// The Board's docked "What's happening?" bar (plan 09r, the D2 pick): the
// affordance to file. What is typed here becomes the summary on the filing
// form the bar pulls up; the form asks for the rest.

export interface QuickBarProps {
  /** Opens the filing form with this summary (possibly empty). */
  onFile: (summary: string) => void;
}

export function QuickBar(props: QuickBarProps) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const file = () => {
    props.onFile(text.trim());
    setText("");
  };
  return (
    <View
      testID="quick-bar"
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
      <View style={styles.field}>
        <Field
          label="What's happening?"
          value={text}
          onChangeText={setText}
          placeholder="One line to start an incident"
          returnKeyType="next"
          onSubmitEditing={file}
          blurOnSubmit
          testID="quick-bar-text"
        />
      </View>
      <View style={styles.button}>
        <Button label="File" onPress={file} testID="quick-bar-file" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  field: { flex: 1 },
  button: { minWidth: 72 },
});
