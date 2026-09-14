// SPDX-License-Identifier: Apache-2.0

import { StyleSheet, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import type { ReportPaneProps } from "@/prototypes/reports/types";

// Variant stub (docs/plans/09z-reports-design.md § The prototype round,
// "Companion"): the pane splits — the report (Account's body) on the left,
// the linked incident read-only on the right, or the link control when
// unlinked. Left to the second builder; this renders only its name so the
// round's harness, table and chrome are reviewable before the three panes
// exist.

export function Companion(_props: ReportPaneProps) {
  const theme = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <Text variant="heading" align="center">
        Companion
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
});
