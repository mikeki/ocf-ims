// SPDX-License-Identifier: Apache-2.0

import { View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import type { Viewer } from "@/prototypes/people/types";

// Stub for the second half of the 3c.4 round (docs/plans/09aa-roster-design.md
// § What is fixed): a crew leader's own crews, with members; add from the
// search, remove a plain member, leaders read-only. `ListMyCrews` and
// `useRoster#addToCrew`/`#removeFromCrew` are already wired for this. Left
// for the second builder.

export interface MyCrewsProps {
  eventId: number;
  viewer: Viewer;
}

export function MyCrews(_props: MyCrewsProps) {
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
        My crews — not built in this half.
      </Text>
    </View>
  );
}
