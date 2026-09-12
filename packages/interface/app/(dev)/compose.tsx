// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/design/theme";
import { Intake } from "@/prototypes/d2/Intake";
import { Picker } from "@/prototypes/d2/Picker";
import { Radio } from "@/prototypes/d2/Radio";
import { Walk } from "@/prototypes/d2/Walk";

// The D2 prototype surface (plan 09r): dev-only, outside the session gates,
// deleted after the pick. `?v=1..3` selects the variant; switching re-mounts
// it, so every walk starts from the fixture event.

const VARIANTS = [
  { name: "Radio", render: () => <Radio /> },
  { name: "Intake", render: () => <Intake /> },
  { name: "Walk", render: () => <Walk /> },
];

export default function ComposeRoute() {
  const theme = useTheme();
  const router = useRouter();
  const { v } = useLocalSearchParams<{ v?: string }>();
  const parsed = Number.parseInt(v ?? "1", 10);
  const current =
    Number.isFinite(parsed) && parsed >= 1 && parsed <= VARIANTS.length
      ? parsed - 1
      : 0;
  const select = useCallback(
    (index: number) => router.setParams({ v: String(index + 1) }),
    [router],
  );
  const variant = VARIANTS[current] ?? VARIANTS[0];

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {/* Harness padding so the picker never covers a screen header. */}
      <View key={current} style={[styles.fill, styles.stage]}>
        {variant?.render()}
      </View>
      <Picker
        names={VARIANTS.map((x) => x.name)}
        current={current}
        onSelect={select}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stage: { paddingTop: 72 },
});
