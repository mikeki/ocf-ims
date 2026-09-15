// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { CellRendererProps } from "@react-native/virtualized-lists";
import { useContext, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Badge } from "@/design/primitives/Badge";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { EmptyState } from "@/features/shell/EmptyState";
import { Avatar } from "@/prototypes/people/Avatar";
import { OpenMenuContext } from "@/prototypes/people/openMenu";
import { PeopleHelpSheet } from "@/prototypes/people/PeopleHelpSheet";
import { matches } from "@/prototypes/people/peopleQuery";
import { rungLabel } from "@/prototypes/people/roles";
import type { RosterPaneProps } from "@/prototypes/people/types";
import { usePeopleKeyboardMap } from "@/prototypes/people/usePeopleKeyboardMap";
import { rungsFor } from "@/prototypes/people/useRoster";

// The Directory variant (docs/plans/09aa-roster-design.md § The prototype
// round): a name first — one alphabetical column, a letter index at the
// right edge, a large search field, and a facet rail on the left (Role,
// Crew, "Can sign in"; counts against the whole roster, not cross-filtered
// by another facet's picks — the round's own simplification, not a shape
// the brief asked for). The role chip on a row IS the menu (no separate
// text trigger, unlike `RoleMenu`'s own Table cell) — its dropdown is a
// small hand-rolled twin of `RoleMenu`'s (same rungs, same hard cut, same
// `stopPropagation` guard) since `RoleMenu.tsx` itself is a text trigger,
// not a chip, and this round may not change it. The free-text search and
// the facets both apply together (AND); decision 4 ("Directory is
// search-first") is read as the search field's visual weight, not as facets
// being ignored.

const ROLE_ORDER: ParticipationType[] = [
  ParticipationType.WRITER,
  ParticipationType.CREW_LEADER,
  ParticipationType.REPORTER,
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];

const NAME_COLUMN_WIDTH = 220;
const ROW_HEIGHT = 64;
const RAIL_WIDTH = 200;
const LETTER_COLUMN_WIDTH = 28;

/** Fair name first, legal name next — the same precedence the Table/ProfileCard already display by (`person.name || person.handle`), read consistently here for both sort and label. */
function displayLabel(person: Person): string {
  return person.name || person.handle || `Person #${person.personId}`;
}

interface FacetOption {
  key: string;
  label: string;
  count: number;
}

function facetMatches(person: Person, selected: ReadonlySet<string>): boolean {
  const roleKeys = [...selected].filter((k) => k.startsWith("role:"));
  if (
    roleKeys.length > 0 &&
    !roleKeys.includes(`role:${person.participationType}`)
  ) {
    return false;
  }
  const crewKeys = [...selected].filter((k) => k.startsWith("crew:"));
  if (
    crewKeys.length > 0 &&
    !person.crews.some((c) => crewKeys.includes(`crew:${c.crewSlug}`))
  ) {
    return false;
  }
  const accessKeys = [...selected].filter((k) => k.startsWith("access:"));
  if (accessKeys.length > 0) {
    const key = person.hasPassword ? "access:yes" : "access:no";
    if (!accessKeys.includes(key)) {
      return false;
    }
  }
  return true;
}

export function Directory(props: RosterPaneProps) {
  const { people, viewer, roster, onOpen, search, query } = props;
  const theme = useTheme();
  const [help, setHelp] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<FlatList<Person>>(null);
  // The row whose role-chip menu is open, so its cell can be raised above
  // the next row (09aa fix: FlatList cells are later siblings that
  // otherwise paint over an open menu).
  const [openMenuFor, setOpenMenuFor] = useState<number | undefined>(undefined);

  const toggleFacet = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const roleFacets = useMemo<FacetOption[]>(
    () =>
      ROLE_ORDER.map((type) => ({
        key: `role:${type}`,
        label: rungLabel(type),
        count: people.filter((p) => p.participationType === type).length,
      })).filter((f) => f.count > 0),
    [people],
  );

  const crewFacets = useMemo<FacetOption[]>(() => {
    const byCrew = new Map<string, { name: string; count: number }>();
    for (const person of people) {
      for (const crew of person.crews) {
        const entry = byCrew.get(crew.crewSlug) ?? {
          name: crew.crewName,
          count: 0,
        };
        entry.count += 1;
        byCrew.set(crew.crewSlug, entry);
      }
    }
    return [...byCrew.entries()]
      .map(([slug, v]) => ({
        key: `crew:${slug}`,
        label: v.name,
        count: v.count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [people]);

  const accessFacets = useMemo<FacetOption[]>(() => {
    const yes = people.filter((p) => p.hasPassword).length;
    const no = people.length - yes;
    return [
      { key: "access:yes", label: "Can sign in", count: yes },
      { key: "access:no", label: "No login", count: no },
    ].filter((f) => f.count > 0);
  }, [people]);

  const filtered = useMemo(
    () =>
      people
        .filter((p) => matches(p, search) && facetMatches(p, selected))
        .sort((a, b) => displayLabel(a).localeCompare(displayLabel(b))),
    [people, search, selected],
  );

  const letters = useMemo(() => {
    const present = new Set<string>();
    for (const person of filtered) {
      const letter = displayLabel(person).slice(0, 1).toUpperCase();
      if (/[A-Z]/.test(letter)) {
        present.add(letter);
      }
    }
    return [...present].sort();
  }, [filtered]);

  const jumpTo = (letter: string) => {
    const index = filtered.findIndex(
      (p) => displayLabel(p).slice(0, 1).toUpperCase() === letter,
    );
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, animated: false });
    }
  };

  const order = useMemo(() => filtered.map((p) => p.personId), [filtered]);

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

  return (
    <OpenMenuContext.Provider value={openMenuFor}>
      <View style={styles.fill}>
        <Toolbar
          total={people.length}
          shown={filtered.length}
          query={query}
          search={search}
          onHelp={() => setHelp(true)}
        />
        {filtered.length === 0 ? (
          <EmptyState
            title={people.length === 0 ? "No one on this roster" : "No matches"}
            message={
              people.length === 0
                ? "Nobody has been added to this event yet."
                : "Nothing matches the search and the facets."
            }
          />
        ) : (
          <View style={styles.body}>
            <View
              style={[
                styles.rail,
                { width: RAIL_WIDTH, borderRightColor: theme.colors.border },
              ]}
            >
              <View
                style={{ padding: theme.spacing.md, gap: theme.spacing.lg }}
              >
                <FacetGroup
                  title="Role"
                  options={roleFacets}
                  selected={selected}
                  onToggle={toggleFacet}
                />
                <FacetGroup
                  title="Crew"
                  options={crewFacets}
                  selected={selected}
                  onToggle={toggleFacet}
                />
                <FacetGroup
                  title="Can sign in"
                  options={accessFacets}
                  selected={selected}
                  onToggle={toggleFacet}
                />
              </View>
            </View>
            <FlatList
              ref={listRef}
              style={styles.fill}
              data={filtered}
              keyExtractor={(p) => String(p.personId)}
              getItemLayout={(_, index) => ({
                length: ROW_HEIGHT,
                offset: ROW_HEIGHT * index,
                index,
              })}
              onScrollToIndexFailed={(info) => {
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: false,
                });
              }}
              CellRendererComponent={CellRenderer}
              renderItem={({ item }) => (
                <Row
                  person={item}
                  viewer={viewer}
                  roster={roster}
                  selected={item.personId === query.selectedId}
                  onPress={() => onOpen(item.personId)}
                  onMenuOpenChange={(open) =>
                    setOpenMenuFor(open ? item.personId : undefined)
                  }
                />
              )}
              testID="people-directory-list"
            />
            <View
              style={[
                styles.letters,
                {
                  width: LETTER_COLUMN_WIDTH,
                  borderLeftColor: theme.colors.border,
                },
              ]}
            >
              {letters.map((letter) => (
                <Pressable
                  key={letter}
                  accessibilityRole="button"
                  accessibilityLabel={`Jump to ${letter}`}
                  onPress={() => jumpTo(letter)}
                  pressRetentionOffset={pressRetentionOffset}
                  testID={`people-directory-letter-${letter}`}
                >
                  {({ pressed }) => (
                    <PressFeedback pressed={pressed} style={styles.letter}>
                      <Text variant="caption" color="primary">
                        {letter}
                      </Text>
                    </PressFeedback>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <PeopleHelpSheet open={help} onClose={() => setHelp(false)} />
      </View>
    </OpenMenuContext.Provider>
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
          paddingVertical: theme.spacing.md,
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <TextInput
        ref={props.query.searchRef}
        accessibilityLabel="Search people"
        placeholder="Search everyone  /"
        placeholderTextColor={theme.colors.textMuted}
        value={props.search}
        onChangeText={props.query.onSearchChange}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.search,
          theme.type.heading,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.borderStrong,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
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

function FacetGroup(props: {
  title: string;
  options: FacetOption[];
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const theme = useTheme();
  if (props.options.length === 0) {
    return null;
  }
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label" color="textMuted">
        {props.title}
      </Text>
      {props.options.map((option) => {
        const active = props.selected.has(option.key);
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => props.onToggle(option.key)}
            pressRetentionOffset={pressRetentionOffset}
            testID={`people-directory-facet-${option.key}`}
          >
            {({ pressed }) => (
              <PressFeedback
                pressed={pressed}
                style={[
                  styles.facetRow,
                  {
                    backgroundColor: active
                      ? theme.colors.surfaceRaised
                      : "transparent",
                    borderRadius: theme.radii.sm,
                    paddingHorizontal: theme.spacing.sm,
                    gap: theme.spacing.sm,
                  },
                ]}
              >
                <Text
                  variant="label"
                  color={active ? "primary" : "text"}
                  style={styles.fill}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
                {active ? (
                  <Badge label={String(option.count)} tone="info" />
                ) : (
                  <Text variant="caption" color="textMuted">
                    {option.count}
                  </Text>
                )}
              </PressFeedback>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

interface RowProps {
  person: Person;
  viewer: RosterPaneProps["viewer"];
  roster: RosterPaneProps["roster"];
  selected: boolean;
  onPress: () => void;
  onMenuOpenChange: (open: boolean) => void;
}

function Row(props: RowProps) {
  const { person, viewer, roster, selected, onPress, onMenuOpenChange } = props;
  const theme = useTheme();
  const label = displayLabel(person);

  return (
    // Not role="button": RN Web renders that as <button>, and this row holds
    // the role menu's own button (09aa finding).
    <Pressable
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
      testID={`people-directory-row-${person.personId}`}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.row,
            {
              height: ROW_HEIGHT,
              paddingHorizontal: theme.spacing.lg,
              gap: theme.spacing.md,
              borderBottomColor: theme.colors.border,
              backgroundColor: selected
                ? theme.colors.surfaceRaised
                : theme.colors.surface,
            },
          ]}
        >
          <Avatar person={person} size={32} />
          <View style={{ width: NAME_COLUMN_WIDTH, flexShrink: 1 }}>
            <View style={[styles.inline, { gap: theme.spacing.xs }]}>
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
            ) : !person.hasPassword ? (
              <Text variant="caption" color="textMuted">
                No login
              </Text>
            ) : null}
          </View>
          <RoleChip
            person={person}
            viewer={viewer}
            roster={roster}
            onOpenChange={onMenuOpenChange}
          />
          <View
            style={[
              styles.fill,
              styles.inline,
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
        </PressFeedback>
      )}
    </Pressable>
  );
}

/**
 * The role chip is the menu (§ What to build, 2): a tinted `Badge` for the
 * trigger — `RoleMenu.tsx` itself renders a text label, not a chip, and this
 * round may not edit it — so the dropdown beneath is a small hand-rolled
 * twin of `RoleMenu`'s own (same rungs, same hard cut, the same
 * `stopPropagation` guard so the row's own press, which opens the profile,
 * never also fires).
 */
function RoleChip(props: {
  person: Person;
  viewer: RosterPaneProps["viewer"];
  roster: RosterPaneProps["roster"];
  onOpenChange: (open: boolean) => void;
}) {
  const { person, viewer, roster, onOpenChange } = props;
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const rungs = rungsFor(viewer, person);
  const pending = roster.pendingFor(person.personId);
  const error = roster.errorFor(person.personId);
  const label = rungLabel(person.participationType);

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };

  if (rungs.length === 0) {
    return <Badge label={label} tone="neutral" />;
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change role, currently ${label}`}
        accessibilityState={{ expanded: open, busy: pending }}
        onPress={(e) => {
          e.stopPropagation();
          setOpenState(!open);
        }}
        pressRetentionOffset={pressRetentionOffset}
        testID={`people-directory-row-${person.personId}-role`}
      >
        {({ pressed }) => (
          <PressFeedback pressed={pressed}>
            <Badge label={label} tone="neutral" />
          </PressFeedback>
        )}
      </Pressable>
      {open ? (
        <View
          accessibilityRole="menu"
          style={[
            styles.menu,
            theme.elevation[2],
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.borderStrong,
              borderRadius: theme.radii.md,
            },
          ]}
          testID={`people-directory-row-${person.personId}-role-menu`}
        >
          {rungs.map((rung) => (
            <Pressable
              key={rung}
              accessibilityRole="menuitem"
              onPress={(e) => {
                e.stopPropagation();
                setOpenState(false);
                void roster.setRole(person.personId, rung);
              }}
              pressRetentionOffset={pressRetentionOffset}
              testID={`people-directory-row-${person.personId}-role-option-${rung}`}
            >
              {({ pressed }) => (
                <PressFeedback
                  pressed={pressed}
                  style={[
                    styles.option,
                    { paddingHorizontal: theme.spacing.md },
                  ]}
                >
                  <Text variant="label">{rungLabel(rung)}</Text>
                </PressFeedback>
              )}
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? (
        <Text variant="caption" color="danger">
          {error.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  search: { minWidth: 320, borderWidth: 1, outlineWidth: 0 },
  spacer: { flex: 1 },
  raisedCell: { zIndex: 1 },
  body: { flex: 1, flexDirection: "row" },
  rail: { borderRightWidth: StyleSheet.hairlineWidth },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inline: { flexDirection: "row", alignItems: "center" },
  facetRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: touchTarget - 8,
  },
  letters: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  letter: {
    minHeight: touchTarget - 12,
    minWidth: touchTarget - 12,
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    position: "absolute",
    top: "100%",
    right: 0,
    minWidth: 160,
    borderWidth: 1,
    zIndex: 10,
    overflow: "hidden",
  },
  option: {
    minHeight: touchTarget - 8,
    justifyContent: "center",
  },
});

function CellRenderer({
  item,
  style,
  children,
  onLayout,
}: CellRendererProps<Person>) {
  const openMenuFor = useContext(OpenMenuContext);
  const raised = item.personId === openMenuFor;
  return (
    <View
      style={[style, raised ? styles.raisedCell : null]}
      onLayout={onLayout}
    >
      {children}
    </View>
  );
}
