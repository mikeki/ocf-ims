// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { StateFade } from "@/design/motion";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import type { Dispatch } from "@/prototypes/dispatch/useDispatch";

// What every variant shows over itself (plan 09x): the `?` help sheet — the
// visible affordance for every shortcut — and a transient notice for the
// controls this surface only stubs. Both are content the person asked for,
// so both may `StateFade`; nothing else here moves.

const KEYS: [string, string][] = [
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
  ["n", "New incident"],
  ["m", "Multi-event search"],
  ["a", "Focus the composer on the open incident"],
  ["h", "Show or hide system entries"],
  ["?", "This sheet"],
  ["p  ·  P", "(harness) poke another row · poke the selected row"],
  ["1 2 3  ·  ← →", "(harness) switch variant"],
];

export interface OverlaysProps {
  d: Dispatch;
  children: ReactNode;
}

export function Overlays(props: OverlaysProps) {
  const { d, children } = props;
  const theme = useTheme();
  return (
    <View style={styles.fill}>
      {children}
      {d.notice ? (
        <View style={[styles.noticeAnchor, styles.passThrough]}>
          <StateFade key={d.notice}>
            <Box
              bg="surfaceRaised"
              radius="md"
              px="md"
              py="sm"
              style={theme.elevation[1]}
              accessibilityLiveRegion="polite"
            >
              <Text variant="label">{d.notice}</Text>
            </Box>
          </StateFade>
        </View>
      ) : null}
      {d.help ? (
        <StateFade style={StyleSheet.absoluteFill}>
          <Pressable
            accessibilityLabel="Close keyboard help"
            onPress={() => d.setHelp(false)}
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
                  <View
                    key={key}
                    style={[styles.row, { gap: theme.spacing.lg }]}
                  >
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  passThrough: { pointerEvents: "none" },
  noticeAnchor: {
    position: "absolute",
    top: 12,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
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
