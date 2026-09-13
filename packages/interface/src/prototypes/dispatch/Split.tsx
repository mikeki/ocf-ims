// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { FilterBar } from "@/prototypes/dispatch/FilterBar";
import { IncidentPane } from "@/prototypes/dispatch/IncidentPane";
import type { Density } from "@/prototypes/dispatch/IncidentRow";
import { Overlays } from "@/prototypes/dispatch/Overlays";
import { Table } from "@/prototypes/dispatch/Table";
import type { Dispatch } from "@/prototypes/dispatch/useDispatch";

// Split — persistence: the table is the workspace. Table left, the selected
// incident right, both always on screen; the arrow keys walk the table and
// the pane follows as a hard cut. The plan's stated default (E15). Its cost
// is the table's width: the pane takes `PANE_SHARE` of the content, never less
// than `PANE_MIN`, and the table keeps what is left.

/** The pane takes this share of the content, never less than an editor needs. */
const PANE_SHARE = 0.4;
const PANE_MIN = 360;

export function Split(props: { d: Dispatch; density: Density }) {
  const { d } = props;
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  return (
    <Overlays d={d}>
      <View
        style={styles.row}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <View style={styles.fill}>
          <FilterBar d={d} />
          <Table d={d} density={props.density} onRowPress={d.select} />
        </View>
        <View
          style={[
            styles.pane,
            {
              width: Math.max(PANE_MIN, Math.round(width * PANE_SHARE)),
              borderLeftColor: theme.colors.border,
            },
          ]}
        >
          {d.opened ? (
            <IncidentPane d={d} incident={d.opened} />
          ) : (
            <Box
              flex={1}
              bg="background"
              align="center"
              justify="center"
              p="xl"
              gap="sm"
            >
              <Text variant="heading" align="center" color="textMuted">
                Nothing selected
              </Text>
              <Text variant="body" align="center" color="textMuted">
                Click a row, or j / k. The pane follows the selection; Enter
                puts the cursor in the composer.
              </Text>
            </Box>
          )}
        </View>
      </View>
    </Overlays>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: "row" },
  pane: { borderLeftWidth: StyleSheet.hairlineWidth },
});
