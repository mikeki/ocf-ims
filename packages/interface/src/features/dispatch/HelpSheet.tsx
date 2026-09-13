// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet, View } from "react-native";
import { StateFade } from "@/design/motion";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// The `?` help sheet (plan 09x criterion 11), promoted from
// src/prototypes/dispatch/Overlays.tsx: a visible affordance for every bound
// key, minus the notice toast and the harness-only rows. `n` only appears
// when it is actually bound (`writeIncidents`); `a` and `h` are left off —
// they are registered nowhere yet (see `useKeyboardMap`'s note) and a
// keyboard-only feature that does nothing is not a feature.

export interface HelpSheetProps {
  open: boolean;
  onClose: () => void;
  writeIncidents: boolean;
}

export function HelpSheet(props: HelpSheetProps) {
  const { open, onClose, writeIncidents } = props;
  const theme = useTheme();
  if (!open) {
    return null;
  }
  const keys: [string, string][] = [
    ["/", "Focus the search"],
    [
      "Enter (in search)",
      "A bare number opens that incident; otherwise focus the table",
    ],
    ["j / ↓  ·  k / ↑", "Move the selection"],
    [
      "Enter",
      "Open the selected incident; in the drawer, again for the full page",
    ],
    ["Esc", "Close · clear the selection · clear the search"],
    ...(writeIncidents ? ([["n", "New incident"]] as [string, string][]) : []),
    ["?", "This sheet"],
  ];
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
            {keys.map(([key, what]) => (
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
  sheet: { width: 520, maxWidth: "100%" },
  row: { flexDirection: "row", alignItems: "flex-start" },
  key: { width: 150 },
  what: { flex: 1 },
});
