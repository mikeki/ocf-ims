// SPDX-License-Identifier: Apache-2.0

import { StyleSheet, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import type { ReportPaneProps } from "@/prototypes/reports/types";

// Variant stub (docs/plans/09z-reports-design.md § The prototype round,
// "Ledger"): the 3c.2 Ledger applied as is — summary as the heading with
// Edit, a Details card, the journal newest first with the composer at its
// top. Left to the second builder; this renders only its name so the round's
// harness, table and chrome are reviewable before the three panes exist.

export function Ledger(_props: ReportPaneProps) {
  const theme = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <Text variant="heading" align="center">
        Ledger
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
});
