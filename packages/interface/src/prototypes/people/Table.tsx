// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Badge } from "@/design/primitives/Badge";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { EmptyState } from "@/features/shell/EmptyState";
import { Avatar } from "@/prototypes/people/Avatar";
import { PeopleHelpSheet } from "@/prototypes/people/PeopleHelpSheet";
import { matches } from "@/prototypes/people/peopleQuery";
import { RoleMenu } from "@/prototypes/people/RoleMenu";
import { orderFor, sectionsFor } from "@/prototypes/people/roles";
import type { RosterPaneProps } from "@/prototypes/people/types";
import { usePeopleKeyboardMap } from "@/prototypes/people/usePeopleKeyboardMap";
import { rungsFor } from "@/prototypes/people/useRoster";

// The Table variant (docs/plans/09aa-roster-design.md § The prototype
// round): templ's 53c grouping done in the 3c.1 table shape — Name (picture,
// handle as caption, the admin shield) · Role · Crews · Wristband, sectioned
// by standing with a header row and a count, name-only people in a second
// "No login" block. Role is a menu on the cell (RoleMenu); a row opens the
// card in the drawer; the search filters every section (decision 4). No
// fixed-height virtualization here (unlike ReportTable) — the roster tops
// out around two hundred rows, well inside what a plain FlatList renders.

const NAME_WIDTH = 220;
const ROLE_WIDTH = 160;
const WRISTBAND_WIDTH = 110;

type Row =
  | { type: "header"; key: string; label: string; count: number }
  | { type: "person"; key: string; person: Person };

export function Table(props: RosterPaneProps) {
  const { people, viewer, roster, onOpen, search, query } = props;
  // `?` is local state, like dispatch's own table (§ Keyboard) — it never
  // needs to survive a variant switch or a reload.
  const [help, setHelp] = useState(false);

  const filtered = useMemo(
    () => people.filter((p) => matches(p, search)),
    [people, search],
  );
  const sections = useMemo(() => sectionsFor(filtered), [filtered]);
  const order = useMemo(() => orderFor(filtered), [filtered]);

  usePeopleKeyboardMap({
    order,
    query: { open: query.openedId, sel: query.selectedId, q: search },
    help,
    setHelp,
    setQuery: (patch) => {
      if (patch.q !== undefined) {
        query.onSearchChange(patch.q);
      }
    },
    select: query.onSelect,
    open: onOpen,
    close: query.onClose,
    onAddPerson: query.onAddPerson,
    searchRef: query.searchRef,
  });

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const section of sections) {
      out.push({
        type: "header",
        key: `header-${section.key}`,
        label: section.label,
        count: section.people.length,
      });
      for (const person of section.people) {
        out.push({ type: "person", key: `person-${person.personId}`, person });
      }
    }
    return out;
  }, [sections]);

  return (
    <View style={styles.fill}>
      <Toolbar
        total={people.length}
        shown={filtered.length}
        query={query}
        search={search}
        onHelp={() => setHelp(true)}
      />
      <ColumnHeader />
      <FlatList
        style={styles.fill}
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) =>
          item.type === "header" ? (
            <SectionHeader label={item.label} count={item.count} />
          ) : (
            <PersonRow
              person={item.person}
              viewer={viewer}
              roster={roster}
              selected={item.person.personId === query.selectedId}
              onPress={() => onOpen(item.person.personId)}
            />
          )
        }
        ListEmptyComponent={
          <EmptyState
            title={people.length === 0 ? "No one on this roster" : "No matches"}
            message={
              people.length === 0
                ? "Nobody has been added to this event yet."
                : "Nothing matches this search."
            }
          />
        }
        testID="people-table"
      />
      <PeopleHelpSheet open={help} onClose={() => setHelp(false)} />
    </View>
  );
}

function Toolbar(props: {
  total: number;
  shown: number;
  query: RosterPaneProps["query"];
  search: string;
  onHelp: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.toolbar,
        {
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <TextInput
        ref={props.query.searchRef}
        accessibilityLabel="Search people"
        placeholder="Search  /"
        placeholderTextColor={theme.colors.textMuted}
        value={props.search}
        onChangeText={props.query.onSearchChange}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.search,
          theme.type.body,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.borderStrong,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
          },
        ]}
        testID="people-search"
      />
      <View style={styles.spacer} />
      <Text variant="caption" color="textMuted">
        {`${props.shown} of ${props.total}`}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={props.query.onAddPerson}
        pressRetentionOffset={pressRetentionOffset}
        testID="people-add"
      >
        {({ pressed }) => (
          <PressFeedback pressed={pressed}>
            <Text variant="label" color="primary">
              Add person
            </Text>
          </PressFeedback>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={props.onHelp}
        pressRetentionOffset={pressRetentionOffset}
      >
        {({ pressed }) => (
          <PressFeedback pressed={pressed}>
            <Text variant="label" color="textMuted">
              Keys ?
            </Text>
          </PressFeedback>
        )}
      </Pressable>
    </View>
  );
}

function ColumnHeader() {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="header"
      style={[
        styles.columnHeader,
        {
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.md,
          backgroundColor: theme.colors.surfaceSunken,
          borderBottomColor: theme.colors.border,
          paddingVertical: theme.spacing.sm,
        },
      ]}
    >
      <Text variant="label" color="textMuted" style={{ width: NAME_WIDTH }}>
        Name
      </Text>
      <Text variant="label" color="textMuted" style={{ width: ROLE_WIDTH }}>
        Role
      </Text>
      <Text variant="label" color="textMuted" style={styles.flexCell}>
        Crews
      </Text>
      <Text
        variant="label"
        color="textMuted"
        style={{ width: WRISTBAND_WIDTH }}
      >
        Wristband
      </Text>
    </View>
  );
}

function SectionHeader(props: { label: string; count: number }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.sectionHeader,
        {
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.xs,
          backgroundColor: theme.colors.surfaceSunken,
        },
      ]}
    >
      <Text variant="label" color="textMuted">
        {props.label} · {props.count}
      </Text>
    </View>
  );
}

interface PersonRowProps {
  person: Person;
  viewer: RosterPaneProps["viewer"];
  roster: RosterPaneProps["roster"];
  selected: boolean;
  onPress: () => void;
}

function PersonRow(props: PersonRowProps) {
  const { person, viewer, roster, selected, onPress } = props;
  const theme = useTheme();
  const rungs = rungsFor(viewer, person);
  const label = person.name || person.handle || `Person #${person.personId}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
      testID={`people-row-${person.personId}`}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.row,
            {
              minHeight: touchTarget,
              paddingHorizontal: theme.spacing.lg,
              gap: theme.spacing.md,
              borderBottomColor: theme.colors.border,
              backgroundColor: selected
                ? theme.colors.surfaceRaised
                : theme.colors.surface,
            },
          ]}
        >
          <View
            style={[styles.row, { width: NAME_WIDTH, gap: theme.spacing.sm }]}
          >
            <Avatar person={person} size={32} />
            <View style={{ flexShrink: 1 }}>
              <View style={[styles.row, { gap: theme.spacing.xs }]}>
                <Text variant="body" numberOfLines={1}>
                  {label}
                </Text>
                {person.isAdmin ? (
                  <Badge label="Admin" tone="restricted" />
                ) : null}
              </View>
              {person.handle && person.name ? (
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {person.handle}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={{ width: ROLE_WIDTH }}>
            <RoleMenu
              person={person}
              rungs={rungs}
              onSelect={(rung) => void roster.setRole(person.personId, rung)}
              pending={roster.pendingFor(person.personId)}
              error={roster.errorFor(person.personId)}
              testID={`people-row-${person.personId}-role`}
            />
          </View>
          <View
            style={[
              styles.flexCell,
              styles.row,
              { flexWrap: "wrap", gap: theme.spacing.xs },
            ]}
          >
            {person.crews.map((c) => (
              <Badge
                key={c.crewSlug}
                label={c.isLeader ? `${c.crewName} · leads` : c.crewName}
                tone={c.isLeader ? "info" : "neutral"}
              />
            ))}
          </View>
          <View style={{ width: WRISTBAND_WIDTH }}>
            <Text variant="caption" color="textMuted">
              {person.wristband ?? ""}
            </Text>
          </View>
        </PressFeedback>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  search: { width: 220, borderWidth: 1, outlineWidth: 0 },
  spacer: { flex: 1 },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flexCell: { flex: 1, minWidth: 0 },
});
