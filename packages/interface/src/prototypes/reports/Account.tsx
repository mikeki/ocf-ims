// SPDX-License-Identifier: Apache-2.0

import { StyleSheet, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import type { ReportPaneProps } from "@/prototypes/reports/types";

// Variant stub (docs/plans/09z-reports-design.md § The prototype round,
// "Account"): the report as a page — a title, a byline, dated paragraphs
// oldest first, a thin controls strip. Left to the second builder; this
// renders only its name so the round's harness, table and chrome are
// reviewable before the three panes exist.

export function Account(_props: ReportPaneProps) {
  const theme = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <Text variant="heading" align="center">
        Account
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
});
