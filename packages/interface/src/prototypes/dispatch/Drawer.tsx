// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/design/theme";
import { FilterBar } from "@/prototypes/dispatch/FilterBar";
import { IncidentPane } from "@/prototypes/dispatch/IncidentPane";
import type { Density } from "@/prototypes/dispatch/IncidentRow";
import { neighboursOf } from "@/prototypes/dispatch/neighbours";
import { Overlays } from "@/prototypes/dispatch/Overlays";
import { Table } from "@/prototypes/dispatch/Table";
import type { Dispatch } from "@/prototypes/dispatch/useDispatch";

// Drawer — focus: the table is the backdrop. Full width until a row opens
// the incident as a wide panel over the right two-thirds, the table dimmed
// but visible behind it; Esc (or the scrim, or Incidents) closes back to
// the same scroll and selection. The panel appears as a hard cut. Its cost
// is what it hides: the columns it covers are the ones it claims to keep
// in view, and a poke to the table lands behind the scrim.

/** The panel's share of the content width. */
const DRAWER_SHARE = "66%";

export function Drawer(props: { d: Dispatch; density: Density }) {
  const { d } = props;
  const theme = useTheme();
  if (d.opened && d.query.full) {
    // The full page (the maintainer's amendment, 2026-09-13): pushed from
    // the drawer, so back lands on the drawer, then on the table.
    return (
      <Overlays d={d}>
        <IncidentPane
          d={d}
          incident={d.opened}
          back={{ label: "Incidents", onPress: d.close }}
          neighbours={neighboursOf(d.visible, d.opened.number)}
        />
      </Overlays>
    );
  }
  return (
    <Overlays d={d}>
      <View style={styles.fill}>
        <FilterBar d={d} />
        <View style={styles.fill}>
          <Table d={d} density={props.density} onRowPress={d.open} />
          {d.opened ? (
            <View style={StyleSheet.absoluteFill}>
              <Pressable
                accessibilityLabel="Close the incident"
                onPress={d.close}
                style={[
                  styles.scrim,
                  { backgroundColor: theme.colors.overlay },
                ]}
              />
              <View
                style={[
                  styles.panel,
                  theme.elevation[2],
                  {
                    width: DRAWER_SHARE,
                    backgroundColor: theme.colors.background,
                    borderLeftColor: theme.colors.borderStrong,
                  },
                ]}
                testID="dispatch-drawer"
              >
                <IncidentPane
                  d={d}
                  incident={d.opened}
                  back={{ label: "Incidents", onPress: d.close }}
                  neighbours={neighboursOf(d.visible, d.opened.number)}
                  onFull={d.openFull}
                />
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Overlays>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  panel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});
