// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet, View } from "react-native";
import { StateFade } from "@/design/motion";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// The roster's `?` help sheet, retyped from dispatch's HelpSheet.tsx
// (incident-worded there) for the roster's own bindings: no `a`/`h`
// (composer / system entries) — a person carries neither.

export interface PeopleHelpSheetProps {
  open: boolean;
  onClose: () => void;
}

const KEYS: [string, string][] = [
  ["/", "Focus the search"],
  ["j / ↓  ·  k / ↑", "Move the selection"],
  ["Enter", "Open the selected person's card"],
  ["Esc", "Close · clear the selection · clear the search"],
  ["n", "Add person"],
  ["?", "This sheet"],
];

export function PeopleHelpSheet(props: PeopleHelpSheetProps) {
  const { open, onClose } = props;
  const theme = useTheme();
  if (!open) {
    return null;
  }
  return (
    <StateFade style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityLabel="Close keyboard help"
        onPress={onClose}
        style={[styles.scrim, { backgroundColor: theme.colors.overlay }]}
      >
        <Pressable
          accessibilityRole="none"
          onPress={() => undefined}
          style={styles.hug}
        >
          <Box
            bg="surface"
            radius="lg"
            p="xl"
            gap="md"
            style={[styles.sheet, theme.elevation[2]]}
          >
            <Text variant="heading">Keyboard</Text>
            {KEYS.map(([key, what]) => (
              <View key={key} style={[styles.row, { gap: theme.spacing.lg }]}>
                <View style={styles.key}>
                  <Text variant="figure">{key}</Text>
                </View>
                <Text variant="body" color="textMuted" style={styles.what}>
                  {what}
                </Text>
              </View>
            ))}
            <Text variant="caption" color="textMuted">
              Shortcuts pause while an input has focus. Esc or click away to
              close.
            </Text>
          </Box>
        </Pressable>
      </Pressable>
    </StateFade>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  hug: { alignSelf: "center" },
  sheet: { width: 480, maxWidth: "100%" },
  row: { flexDirection: "row", alignItems: "flex-start" },
  key: { width: 150 },
  what: { flex: 1 },
});
