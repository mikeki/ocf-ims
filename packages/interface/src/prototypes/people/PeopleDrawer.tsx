// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/design/theme";
import { drawerShare } from "@/design/tokens";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { ProfileCard } from "@/prototypes/people/ProfileCard";
import type { Viewer } from "@/prototypes/people/types";
import type { Roster } from "@/prototypes/people/useRoster";

// The profile card's drawer (docs/plans/09aa-roster-design.md § What is
// fixed): the panel over the roster's right two thirds, the scrim, its own
// `ScreenHeader` — back "People", the person's name as the title — a
// retyped copy of ReportDrawer.tsx's shape. Round decision 3 (the drawer's
// width reading empty for six lines, not forty) is the maintainer's to
// judge; this keeps the 3c.1 width so the round can actually see it.

export interface PeopleDrawerProps {
  person: Person | undefined;
  viewer: Viewer;
  roster: Roster;
  onClose: () => void;
}

export function PeopleDrawer(props: PeopleDrawerProps) {
  const { person, viewer, roster, onClose } = props;
  const theme = useTheme();
  if (!person) {
    return null;
  }
  const title = person.name || person.handle || `Person #${person.personId}`;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityLabel="Close the profile"
        onPress={onClose}
        style={[styles.scrim, { backgroundColor: theme.colors.overlay }]}
      />
      <View
        style={[
          styles.panel,
          theme.elevation[2],
          {
            width: `${drawerShare * 100}%`,
            backgroundColor: theme.colors.background,
            borderLeftColor: theme.colors.borderStrong,
          },
        ]}
        testID="people-drawer"
      >
        <ScreenHeader
          title={title}
          back={{ label: "People", onPress: onClose }}
        />
        <View style={styles.fill}>
          <ProfileCard person={person} viewer={viewer} roster={roster} />
        </View>
      </View>
    </View>
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
