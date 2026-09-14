// SPDX-License-Identifier: Apache-2.0

import { View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import type { RosterPaneProps } from "@/prototypes/people/types";

// Stub for the second half of the 3c.4 round (docs/plans/09aa-roster-design.md
// § The prototype round): standing as a place — a column per rung, drag with
// a "Move to…" twin. Left for the second builder.

export function Ladder(_props: RosterPaneProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: theme.spacing.xl,
      }}
    >
      <Text variant="body" color="textMuted">
        Ladder — not built in this half.
      </Text>
    </View>
  );
}
