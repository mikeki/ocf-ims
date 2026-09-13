// SPDX-License-Identifier: Apache-2.0

import { StyleSheet, View } from "react-native";
import { FilterBar } from "@/prototypes/dispatch/FilterBar";
import { IncidentPane } from "@/prototypes/dispatch/IncidentPane";
import type { Density } from "@/prototypes/dispatch/IncidentRow";
import { neighboursOf } from "@/prototypes/dispatch/neighbours";
import { Overlays } from "@/prototypes/dispatch/Overlays";
import { Table } from "@/prototypes/dispatch/Table";
import type { Dispatch } from "@/prototypes/dispatch/useDispatch";

// Page — sequence: the table is a place you return to. Full width; a row is
// a route (here `open=214` stands in for `/incidents/214`, pushed so the
// browser's back works), the incident a full page, and the table's filters,
// sort and selection ride in the URL so back lands where you left. What
// templ does today. Its cost is the table itself: gone while you work, and
// "what changed while I was in there" is a badge at best.

export function Page(props: { d: Dispatch; density: Density }) {
  const { d } = props;
  return (
    <Overlays d={d}>
      <View style={styles.fill}>
        {d.opened ? (
          <IncidentPane
            d={d}
            incident={d.opened}
            back={{ label: "Incidents", onPress: d.close }}
            neighbours={neighboursOf(d.visible, d.opened.number)}
          />
        ) : (
          <>
            <FilterBar d={d} />
            <Table d={d} density={props.density} onRowPress={d.open} />
          </>
        )}
      </View>
    </Overlays>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
