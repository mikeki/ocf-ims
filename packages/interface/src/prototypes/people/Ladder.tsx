// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  ParticipationType,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { PressFeedback } from "@/design/motion";
import { Badge } from "@/design/primitives/Badge";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { EmptyState } from "@/features/shell/EmptyState";
import { Avatar } from "@/prototypes/people/Avatar";
import { PeopleHelpSheet } from "@/prototypes/people/PeopleHelpSheet";
import { matches } from "@/prototypes/people/peopleQuery";
import { rungLabel } from "@/prototypes/people/roles";
import type { RosterPaneProps } from "@/prototypes/people/types";
import { usePeopleKeyboardMap } from "@/prototypes/people/usePeopleKeyboardMap";
import { rungsFor } from "@/prototypes/people/useRoster";

// The Ladder variant (docs/plans/09aa-roster-design.md § The prototype
// round): standing as a place — five columns (writers · crew leaders ·
// reporters · volunteers · public), each a vertically scrolling stack of
// cards; the count in the header; a name-only person (`has_password` false)
// sits in their rung's column, dimmed, never a separate block (unlike the
// Table's "No login" section — there is no sixth column here). Changing a
// role is moving a card: a "Move to…" control on every card opens the same
// rungs `rungsFor` would offer a menu (decision 2's Ladder answer); web drag
// was tried and dropped (see the header note on `MoveMenu`) — the menu is
// the only way to move a card, so it was never a "twin" of anything, just
// the one control. The search filters every column (decision 4).

const COLUMN_TYPES: ParticipationType[] = [
  ParticipationType.WRITER,
  ParticipationType.CREW_LEADER,
  ParticipationType.REPORTER,
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];

/** ~180 px at 1024 (§ The prototype round's Ladder row), a multiple of the touch target rather than a bare literal. */
const MIN_COLUMN_WIDTH = touchTarget * 4;

/**
 * Dims a name-only card in place. Not sourced from `tokens.ts`: opacity is
 * not one of the four literal categories that file owns (colour, spacing,
 * font-size, duration) — `Button.tsx`'s own disabled state
 * (`opacity: inactive ? 0.6 : 1`) is the precedent for a plain static
 * opacity number living beside the component it dims.
 */
const NO_LOGIN_OPACITY = 0.55;

/**
 * A person shaped only to ask `rungsFor` which rungs this viewer could EVER
 * set on somebody — not a real target, just a probe for muting a column
 * header (§ Gating and the ceiling: crew leader is never in that answer for
 * anyone, since it's derived, never hand-assigned; writer drops out for an
 * inviter).
 */
function probePerson(): Person {
  return create(PersonSchema, {
    personId: -1,
    hasPassword: true,
    isAdmin: false,
    participationType: ParticipationType.REPORTER,
    crews: [],
  });
}

export function Ladder(props: RosterPaneProps) {
  const { people, viewer, roster, onOpen, search, query } = props;
  const theme = useTheme();
  // `?` is local state, like the Table's own copy (§ Keyboard).
  const [help, setHelp] = useState(false);
  // The card whose "Move to…" menu is open, so its wrapper can be raised
  // above the card below it (09aa fix: mapped cards in a column are later
  // siblings that otherwise paint over an open menu).
  const [openMenuFor, setOpenMenuFor] = useState<number | undefined>(undefined);

  const filtered = useMemo(
    () => people.filter((p) => matches(p, search)),
    [people, search],
  );

  const settable = useMemo(() => rungsFor(viewer, probePerson()), [viewer]);

  const columns = useMemo(
    () =>
      COLUMN_TYPES.map((type) => ({
        type,
        label: rungLabel(type),
        fillable: settable.includes(type),
        people: filtered.filter((p) => p.participationType === type),
      })),
    [filtered, settable],
  );

  const order = useMemo(
    () => columns.flatMap((c) => c.people.map((p) => p.personId)),
    [columns],
  );

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
              : "Nothing matches this search."
          }
        />
      ) : (
        <ScrollView
          horizontal
          style={styles.fill}
          contentContainerStyle={[
            styles.stage,
            { gap: theme.spacing.md, padding: theme.spacing.md },
          ]}
          testID="people-ladder"
        >
          {columns.map((column) => (
            <Column
              key={column.type}
              label={column.label}
              fillable={column.fillable}
              people={column.people}
              viewer={viewer}
              roster={roster}
              selectedId={query.selectedId}
              onOpen={onOpen}
              openMenuFor={openMenuFor}
              onMenuOpenChange={(personId, open) =>
                setOpenMenuFor(open ? personId : undefined)
              }
            />
          ))}
        </ScrollView>
      )}
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

interface ColumnProps {
  label: string;
  fillable: boolean;
  people: Person[];
  viewer: RosterPaneProps["viewer"];
  roster: RosterPaneProps["roster"];
  selectedId: number | undefined;
  onOpen: (personId: number) => void;
  openMenuFor: number | undefined;
  onMenuOpenChange: (personId: number, open: boolean) => void;
}

function Column(props: ColumnProps) {
  const {
    label,
    fillable,
    people,
    viewer,
    roster,
    selectedId,
    onOpen,
    openMenuFor,
    onMenuOpenChange,
  } = props;
  const theme = useTheme();
  return (
    <View
      style={[
        styles.column,
        {
          minWidth: MIN_COLUMN_WIDTH,
          backgroundColor: theme.colors.surfaceSunken,
          borderRadius: theme.radii.lg,
        },
      ]}
    >
      <View
        accessibilityRole="header"
        style={[
          styles.columnHeader,
          {
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <Text variant="label" color={fillable ? "text" : "textMuted"}>
          {label} · {people.length}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={{
          gap: theme.spacing.sm,
          padding: theme.spacing.sm,
        }}
      >
        {people.length === 0 ? (
          <Text variant="caption" color="textMuted">
            None
          </Text>
        ) : (
          people.map((person) => (
            <View
              key={person.personId}
              style={person.personId === openMenuFor ? styles.raisedCard : null}
            >
              <Card
                person={person}
                viewer={viewer}
                roster={roster}
                selected={person.personId === selectedId}
                onPress={() => onOpen(person.personId)}
                onMenuOpenChange={(open) =>
                  onMenuOpenChange(person.personId, open)
                }
              />
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

interface CardProps {
  person: Person;
  viewer: RosterPaneProps["viewer"];
  roster: RosterPaneProps["roster"];
  selected: boolean;
  onPress: () => void;
  onMenuOpenChange: (open: boolean) => void;
}

function Card(props: CardProps) {
  const { person, viewer, roster, selected, onPress, onMenuOpenChange } = props;
  const theme = useTheme();
  const rungs = rungsFor(viewer, person);
  const label = person.name || person.handle || `Person #${person.personId}`;
  const dimmed = !person.hasPassword;

  return (
    // Not role="button": RN Web renders that as <button>, and this row holds
    // the role menu's own button (09aa finding).
    <Pressable
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
      testID={`people-ladder-card-${person.personId}`}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.card,
            {
              opacity: dimmed ? NO_LOGIN_OPACITY : 1,
              backgroundColor: selected
                ? theme.colors.surfaceRaised
                : theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.md,
              padding: theme.spacing.sm,
              gap: theme.spacing.xs,
            },
          ]}
        >
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Avatar person={person} size={32} />
            <View style={{ flexShrink: 1 }}>
              <View style={[styles.row, { gap: theme.spacing.xs }]}>
                <Text variant="label" numberOfLines={1}>
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
          {person.crews.length > 0 ? (
            <View
              style={[styles.row, { flexWrap: "wrap", gap: theme.spacing.xs }]}
            >
              {person.crews.map((c) => (
                <Badge
                  key={c.crewSlug}
                  label={c.isLeader ? `${c.crewName} · leads` : c.crewName}
                  tone={c.isLeader ? "info" : "neutral"}
                />
              ))}
            </View>
          ) : null}
          <MoveMenu
            person={person}
            rungs={rungs}
            onSelect={(rung) => void roster.setRole(person.personId, rung)}
            pending={roster.pendingFor(person.personId)}
            error={roster.errorFor(person.personId)?.message}
            onOpenChange={onMenuOpenChange}
          />
        </PressFeedback>
      )}
    </Pressable>
  );
}

interface MoveMenuProps {
  person: Person;
  rungs: ParticipationType[];
  onSelect: (rung: ParticipationType) => void;
  pending: boolean;
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Move to…", the Ladder's one edit (§ What to build, 1): a hard-cut list of
 * the rungs `rungsFor` offers, same mechanics as `RoleMenu` (open/close with
 * no animation, `stopPropagation` so the card's own press — which opens the
 * profile — never also fires) but its own trigger, since the brief's control
 * reads "Move to…" rather than the current rung. A true web drag between
 * columns was the brief's other half of this control: React Native's
 * `View`/`Pressable` props (checked against `react-native`'s own
 * `types_generated`) carry no `onDragStart`/`onDrop`/`draggable` — nothing to
 * type against on this RN Web build — so per the brief's own fallback this
 * menu is the ONLY way to move a card, not a "twin" of a working drag.
 */
function MoveMenu(props: MoveMenuProps) {
  const { person, rungs, onSelect, pending, error, onOpenChange } = props;
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };

  if (rungs.length === 0) {
    return null;
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Move ${person.name || person.handle || `person ${person.personId}`}`}
        accessibilityState={{ expanded: open, busy: pending }}
        onPress={(e) => {
          e.stopPropagation();
          setOpenState(!open);
        }}
        pressRetentionOffset={pressRetentionOffset}
        testID={`people-ladder-card-${person.personId}-move`}
      >
        {({ pressed }) => (
          <PressFeedback pressed={pressed}>
            <Text variant="label" color={pending ? "textMuted" : "primary"}>
              Move to…
            </Text>
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
          testID={`people-ladder-card-${person.personId}-move-menu`}
        >
          {rungs.map((rung) => (
            <Pressable
              key={rung}
              accessibilityRole="menuitem"
              onPress={(e) => {
                e.stopPropagation();
                setOpenState(false);
                onSelect(rung);
              }}
              pressRetentionOffset={pressRetentionOffset}
              testID={`people-ladder-card-${person.personId}-move-${rung}`}
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
          {error}
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
  search: { width: 220, borderWidth: 1, outlineWidth: 0 },
  spacer: { flex: 1 },
  stage: { flexDirection: "row", alignItems: "flex-start" },
  column: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    overflow: "hidden",
  },
  columnHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  raisedCard: { zIndex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  menu: {
    position: "absolute",
    top: "100%",
    left: 0,
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
