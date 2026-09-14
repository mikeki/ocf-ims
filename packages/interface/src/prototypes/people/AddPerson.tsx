// SPDX-License-Identifier: Apache-2.0

import { View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// Stub for the second half of the 3c.4 round (docs/plans/09aa-roster-design.md
// § What is fixed): search-first — a hit enrols, no hit offers Create
// (name-only or with a login), an inviter's create says it lands as a
// reporter. `useRoster#create`/`#enrol` are already wired for this. Left for
// the second builder.

export interface AddPersonProps {
  onClose: () => void;
}

export function AddPerson(_props: AddPersonProps) {
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
        Add person — not built in this half.
      </Text>
    </View>
  );
}
