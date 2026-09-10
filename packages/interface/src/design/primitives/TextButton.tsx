// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, type TypeVariant } from "@/design/tokens";

// A pressable word: the "Show password" toggle, a linked incident's number.
// It exists so the app has ONE class of pressable — before this, a `Text`
// with an `onPress` announced itself as a button and then answered a press
// with nothing, while the `Button` and the `ListRow` beside it both scaled
// (the /review-animations cohesion finding on 3a.4).
//
// It hugs its label rather than filling the row, so the press scale applies
// to the word and not to a full-width invisible block, and it buys the 44 pt
// touch target back with `hitSlop` rather than by growing the visual
// (DESIGN.md § Accessibility floor).

export interface TextButtonProps {
  label: string;
  /** `label` by default; `figure` for a number, which is tabular. */
  variant?: TypeVariant;
  onPress: () => void;
  testID?: string;
}

export function TextButton(props: TextButtonProps) {
  const { label, variant = "label", onPress, testID } = props;
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
      hitSlop={{
        top: theme.spacing.lg,
        bottom: theme.spacing.lg,
        left: theme.spacing.md,
        right: theme.spacing.md,
      }}
      style={styles.hug}
      testID={testID}
    >
      {({ pressed }) => (
        <PressFeedback pressed={pressed}>
          <Text variant={variant} color="primary">
            {label}
          </Text>
        </PressFeedback>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hug: { alignSelf: "flex-start" },
});
