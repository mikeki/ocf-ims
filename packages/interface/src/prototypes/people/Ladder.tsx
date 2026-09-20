// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  ParticipationType,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  type PointerEvent as RNPointerEvent,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { PressFeedback } from "@/design/motion";
import { Badge } from "@/design/primitives/Badge";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { EmptyState } from "@/features/shell/EmptyState";
import { Avatar } from "@/prototypes/people/Avatar";
import { Hovercard, type Rect } from "@/prototypes/people/Hovercard";
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
// Table's "No login" section — there is no sixth column here). The search
// filters every column (decision 4).
//
// The second cut (the maintainer's pick, plus two asks): a pointer drag
// between columns, and a hovercard in place of the person drawer. The "Move
// to…" menu on every card stays as the twin control the first cut's own
// header note promised once a working drag existed — MoveMenu below is
// unchanged. The drag is pointer-only (web first): `View`/`Pressable` type
// `onPointerDown`/`onPointerMove`/`onPointerUp`/`onPointerCancel` (checked
// against `ViewPropTypes.d.ts`'s own `PointerEventProps`) and Reanimated 4 is
// installed; Gesture Handler is not, and this file must not add it — native
// touch drag is that slice's job, not this one's.

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
 * Dims a name-only card in place, and a card mid-drag (its ghost carries the
 * visible copy). Not sourced from `tokens.ts`: opacity is not one of the
 * four literal categories that file owns (colour, spacing, font-size,
 * duration) — `Button.tsx`'s own disabled state
 * (`opacity: inactive ? 0.6 : 1`) is the precedent for a plain static
 * opacity number living beside the component it dims.
 */
const NO_LOGIN_OPACITY = 0.55;

/** The ghost's own, slighter dip — it's already elevated and mid-air, not withheld like a name-only row. Same non-token precedent as `NO_LOGIN_OPACITY`. */
const GHOST_OPACITY = 0.9;
// A column the drag cannot land in (outside the viewer's ceiling).
const DIMMED_COLUMN_OPACITY = 0.5;

/**
 * A pointer grip, not a touch target — half the minimum touch target, since
 * native touch drag is Gesture Handler's job, not this file's (see the
 * header note).
 */
const GRIP_WIDTH = touchTarget * 0.5;

/** The drop's snap-back, exactly the brief's own spring: not in `theme.motion`, which owns press feedback and state-fade durations only. */
const SNAP_BACK_SPRING = { duration: 400, dampingRatio: 0.8 } as const;

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

function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

interface DragState {
  personId: number;
  fromRung: ParticipationType;
  /** `rungsFor(viewer, THIS person)` at pick-up — a name-only person's own ceiling, not the column headers' generic probe. */
  allowedRungs: ParticipationType[];
}

interface HovercardState {
  personId: number;
  /** Press/Enter opened it — stays open till Esc, an outside press, or another card's own press/Enter. Hover-opened is never pinned. */
  pinned: boolean;
  /** Window coordinates, so the outside-press check needs no DOM node access. */
  anchor: Rect;
}

export function Ladder(props: RosterPaneProps) {
  const { people, viewer, roster, search, query } = props;
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  // `?` is local state, like the Table's own copy (§ Keyboard).
  const [help, setHelp] = useState(false);
  // The card whose "Move to…" menu is open, so its wrapper can be raised
  // above the card below it (09aa fix: mapped cards in a column are later
  // siblings that otherwise paint over an open menu).
  const [openMenuFor, setOpenMenuFor] = useState<number | undefined>(undefined);
  const [dragging, setDragging] = useState<DragState | undefined>(undefined);
  // The column under the pointer while dragging, only committed to state on
  // change (a cheap five-rect loop runs on every move; this is the
  // "throttled" repaint the brief asks for).
  const [highlightRung, setHighlightRung] = useState<
    ParticipationType | undefined
  >(undefined);
  const [hovercard, setHovercard] = useState<HovercardState | undefined>(
    undefined,
  );
  // Mirror for the hover handlers: react-native-web's `useHover` binds the
  // leave listener when the hover starts, so a handler closing over state
  // would see the hovercard as it was before it opened.
  const hovercardRef = useRef<HovercardState | undefined>(undefined);
  hovercardRef.current = hovercard;

  // Card and column rects, kept outside React state (read in pointer
  // handlers, never in render): cards are measured on demand (a hover-open
  // or a pick-up), columns via their own `onLayout`.
  const cardRefs = useRef(new Map<number, View>());
  const columnRectsRef = useRef(new Map<ParticipationType, Rect>());
  const stageRef = useRef<View>(null);
  const stageRectRef = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const hovercardRectRef = useRef<Rect | undefined>(undefined);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    rect: Rect;
  } | null>(null);
  const dragMovedRef = useRef(false);
  // A committed drop leaves the pointer resting where it let go; the reflow
  // fires leave/enter pairs there without any movement, and none of that may
  // read as a hover. Holds the drop point until the pointer actually moves.
  const suppressHoverRef = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const pendingHoverRef = useRef<number | undefined>(undefined);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hitColumnRef = useRef<ParticipationType | undefined>(undefined);
  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const overCardRef = useRef<number | undefined>(undefined);
  const overHovercardRef = useRef(false);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const ghostStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
    ],
  }));

  // Derived from `theme.motion.stateFade` (200 ms) rather than a bare
  // literal — that file owns press-feedback and state-fade durations only,
  // so a hover delay is this component's own number, named per the
  // `NO_LOGIN_OPACITY` precedent above.
  const hoverOpenDelay = theme.motion.stateFade * 1.5;
  const hoverCloseDelay = theme.motion.stateFade * 0.75;
  const dragClickThreshold = theme.spacing.sm;

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

  const draggingPerson = dragging
    ? people.find((p) => p.personId === dragging.personId)
    : undefined;
  const hovercardPerson = hovercard
    ? people.find((p) => p.personId === hovercard.personId)
    : undefined;

  const registerCardRef = useCallback(
    (personId: number) => (el: View | null) => {
      if (el) {
        cardRefs.current.set(personId, el);
      } else {
        cardRefs.current.delete(personId);
      }
    },
    [],
  );

  const clearHoverTimers = useCallback(() => {
    if (hoverOpenTimerRef.current !== undefined) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = undefined;
    }
    if (hoverCloseTimerRef.current !== undefined) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = undefined;
    }
  }, []);

  useEffect(() => clearHoverTimers, [clearHoverTimers]);

  const closeHovercard = useCallback(() => {
    clearHoverTimers();
    overCardRef.current = undefined;
    overHovercardRef.current = false;
    hovercardRectRef.current = undefined;
    hovercardRef.current = undefined;
    setHovercard(undefined);
  }, [clearHoverTimers]);

  // Pinning keeps `sel` and the hovercard in lockstep, exactly as
  // `usePeopleQuery#open` keeps `sel`/`open` together for the Table and
  // Directory's drawer — `j`/`k` while pinned walk from the pinned card, not
  // a stale selection.
  const openHovercard = useCallback(
    (personId: number, pinned: boolean) => {
      if (dragging) {
        return;
      }
      if (pinned) {
        // A press lands inside the hover-open delay; the pending hover must
        // not fire afterwards and downgrade the pin.
        clearHoverTimers();
        query.onSelect(personId);
      }
      const el = cardRefs.current.get(personId);
      if (!el) {
        return;
      }
      el.measureInWindow((x, y, width, height) => {
        const next = { personId, pinned, anchor: { x, y, width, height } };
        hovercardRef.current = next;
        setHovercard(next);
      });
    },
    [dragging, query, clearHoverTimers],
  );

  const handleCardPress = useCallback(
    (personId: number) => {
      // A drag that moved must not also open the profile (§ The drag).
      if (dragMovedRef.current) {
        dragMovedRef.current = false;
        return;
      }
      openHovercard(personId, true);
    },
    [openHovercard],
  );

  const handleCardHoverIn = useCallback(
    (personId: number) => {
      if (dragging || hovercardRef.current?.pinned) {
        return;
      }
      if (suppressHoverRef.current) {
        pendingHoverRef.current = personId;
        return;
      }
      overCardRef.current = personId;
      if (hoverCloseTimerRef.current !== undefined) {
        clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = undefined;
      }
      if (hovercardRef.current?.personId === personId) {
        return;
      }
      if (hoverOpenTimerRef.current !== undefined) {
        clearTimeout(hoverOpenTimerRef.current);
      }
      hoverOpenTimerRef.current = setTimeout(() => {
        hoverOpenTimerRef.current = undefined;
        if (overCardRef.current === personId) {
          openHovercard(personId, false);
        }
      }, hoverOpenDelay);
    },
    [dragging, hoverOpenDelay, openHovercard],
  );

  // Lifts the post-drop suppression once the pointer has moved a click's
  // worth, then replays the hover the card under it reported meanwhile.
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const onMove = (e: PointerEvent) => {
      const from = suppressHoverRef.current;
      if (!from) {
        return;
      }
      if (
        Math.hypot(e.clientX - from.x, e.clientY - from.y) <= dragClickThreshold
      ) {
        return;
      }
      suppressHoverRef.current = undefined;
      const pending = pendingHoverRef.current;
      pendingHoverRef.current = undefined;
      if (pending !== undefined) {
        handleCardHoverIn(pending);
      }
    };
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
  }, [dragClickThreshold, handleCardHoverIn]);

  const handleCardHoverOut = useCallback(
    (personId: number) => {
      if (pendingHoverRef.current === personId) {
        pendingHoverRef.current = undefined;
      }
      if (overCardRef.current === personId) {
        overCardRef.current = undefined;
      }
      if (hoverOpenTimerRef.current !== undefined) {
        clearTimeout(hoverOpenTimerRef.current);
        hoverOpenTimerRef.current = undefined;
      }
      const current = hovercardRef.current;
      if (!current || current.pinned || current.personId !== personId) {
        return;
      }
      if (hoverCloseTimerRef.current !== undefined) {
        clearTimeout(hoverCloseTimerRef.current);
      }
      hoverCloseTimerRef.current = setTimeout(() => {
        hoverCloseTimerRef.current = undefined;
        if (overCardRef.current === undefined && !overHovercardRef.current) {
          closeHovercard();
        }
      }, hoverCloseDelay);
    },
    [hoverCloseDelay, closeHovercard],
  );

  const handleHovercardHoverIn = useCallback(() => {
    overHovercardRef.current = true;
    if (hoverCloseTimerRef.current !== undefined) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = undefined;
    }
  }, []);

  const handleHovercardHoverOut = useCallback(() => {
    overHovercardRef.current = false;
    const current = hovercardRef.current;
    if (!current || current.pinned) {
      return;
    }
    if (hoverCloseTimerRef.current !== undefined) {
      clearTimeout(hoverCloseTimerRef.current);
    }
    hoverCloseTimerRef.current = setTimeout(() => {
      hoverCloseTimerRef.current = undefined;
      if (overCardRef.current === undefined && !overHovercardRef.current) {
        closeHovercard();
      }
    }, hoverCloseDelay);
  }, [hoverCloseDelay, closeHovercard]);

  // A press outside the anchor card and the popover itself closes a pinned
  // hovercard — coordinates only (no DOM node access), matching the rest of
  // this file's approach to hit-testing during the drag.
  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      !hovercard?.pinned
    ) {
      return undefined;
    }
    const current = hovercard;
    const onDown = (e: PointerEvent) => {
      const inAnchor = pointInRect(e.clientX, e.clientY, current.anchor);
      const inCard = hovercardRectRef.current
        ? pointInRect(e.clientX, e.clientY, hovercardRectRef.current)
        : false;
      if (!inAnchor && !inCard) {
        closeHovercard();
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [hovercard, closeHovercard]);

  const startDrag = useCallback(
    (person: Person, clientX: number, clientY: number) => {
      const rungs = rungsFor(viewer, person);
      if (rungs.length === 0) {
        return;
      }
      const cardEl = cardRefs.current.get(person.personId);
      if (!cardEl) {
        return;
      }
      closeHovercard();
      cardEl.measureInWindow((x, y, width, height) => {
        dragStartRef.current = {
          clientX,
          clientY,
          rect: { x, y, width, height },
        };
        dragMovedRef.current = false;
        hitColumnRef.current = undefined;
        setHighlightRung(undefined);
        translateX.set(0);
        translateY.set(0);
        setDragging({
          personId: person.personId,
          fromRung: person.participationType,
          allowedRungs: rungs,
        });
      });
    },
    [viewer, closeHovercard, translateX, translateY],
  );

  const onDragMove = useCallback(
    (e: RNPointerEvent) => {
      if (!dragging || !dragStartRef.current) {
        return;
      }
      const { clientX, clientY } = e.nativeEvent;
      lastPointerRef.current = { x: clientX, y: clientY };
      const dx = clientX - dragStartRef.current.clientX;
      const dy = clientY - dragStartRef.current.clientY;
      translateX.set(dx);
      translateY.set(dy);
      if (!dragMovedRef.current && Math.hypot(dx, dy) > dragClickThreshold) {
        dragMovedRef.current = true;
      }
      let hit: ParticipationType | undefined;
      for (const [type, rect] of columnRectsRef.current) {
        if (
          clientX >= rect.x &&
          clientX <= rect.x + rect.width &&
          clientY >= rect.y &&
          clientY <= rect.y + rect.height
        ) {
          hit = type;
          break;
        }
      }
      if (hit !== hitColumnRef.current) {
        hitColumnRef.current = hit;
        setHighlightRung(hit);
      }
    },
    [dragging, translateX, translateY, dragClickThreshold],
  );

  const finishDrag = useCallback(
    (committed: boolean) => {
      if (!dragging) {
        return;
      }
      const hit = committed ? hitColumnRef.current : undefined;
      const validTarget =
        hit !== undefined &&
        dragging.allowedRungs.includes(hit) &&
        hit !== dragging.fromRung;
      const clear = () => {
        setDragging(undefined);
        setHighlightRung(undefined);
        hitColumnRef.current = undefined;
        dragStartRef.current = null;
      };
      if (validTarget) {
        // A hard cut: no animation plays on a successful drop.
        const personId = dragging.personId;
        suppressHoverRef.current = lastPointerRef.current;
        clear();
        void roster.setRole(personId, hit);
        return;
      }
      if (reducedMotion) {
        translateX.set(0);
        translateY.set(0);
        clear();
        return;
      }
      translateX.set(withSpring(0, SNAP_BACK_SPRING));
      translateY.set(
        withSpring(0, SNAP_BACK_SPRING, (finished) => {
          "worklet";
          if (finished) {
            scheduleOnRN(clear);
          }
        }),
      );
    },
    [dragging, reducedMotion, roster, translateX, translateY],
  );

  const onDragEnd = useCallback(
    (e: RNPointerEvent) => {
      onDragMove(e);
      finishDrag(true);
    },
    [onDragMove, finishDrag],
  );

  const onDragCancel = useCallback(() => finishDrag(false), [finishDrag]);

  usePeopleKeyboardMap({
    order,
    query: {
      open: hovercard?.pinned ? hovercard.personId : undefined,
      sel: query.selectedId,
      q: search,
    },
    help,
    setHelp,
    setQuery: (patch) => {
      if (patch.q !== undefined) {
        query.onSearchChange(patch.q);
      }
    },
    select: query.onSelect,
    open: (personId) => openHovercard(personId, true),
    close: closeHovercard,
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
        <View
          ref={stageRef}
          onLayout={() =>
            stageRef.current?.measureInWindow((x, y, width, height) => {
              stageRectRef.current = { x, y, width, height };
            })
          }
          style={styles.stageWrap}
        >
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
                type={column.type}
                label={column.label}
                fillable={column.fillable}
                highlighted={
                  dragging !== undefined &&
                  highlightRung === column.type &&
                  dragging.allowedRungs.includes(column.type)
                }
                dimmed={
                  dragging !== undefined &&
                  column.type !== dragging.fromRung &&
                  !dragging.allowedRungs.includes(column.type)
                }
                people={column.people}
                viewer={viewer}
                roster={roster}
                selectedId={query.selectedId}
                draggingPersonId={dragging?.personId}
                onOpen={handleCardPress}
                openMenuFor={openMenuFor}
                onMenuOpenChange={(personId, open) =>
                  setOpenMenuFor(open ? personId : undefined)
                }
                onRect={(type, rect) => columnRectsRef.current.set(type, rect)}
                onDragStart={startDrag}
                onCardHoverIn={handleCardHoverIn}
                onCardHoverOut={handleCardHoverOut}
                registerCardRef={registerCardRef}
              />
            ))}
          </ScrollView>
          {dragging ? (
            <View
              style={styles.dragOverlay}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragCancel}
            />
          ) : null}
          {dragging && draggingPerson && dragStartRef.current ? (
            <Animated.View
              style={[
                styles.card,
                styles.ghost,
                ghostStyle,
                theme.elevation[2],
                {
                  position: "absolute",
                  left: dragStartRef.current.rect.x - stageRectRef.current.x,
                  top: dragStartRef.current.rect.y - stageRectRef.current.y,
                  width: dragStartRef.current.rect.width,
                  opacity: GHOST_OPACITY,
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radii.md,
                  padding: theme.spacing.sm,
                  zIndex: 21,
                },
              ]}
            >
              <CardContent person={draggingPerson} />
            </Animated.View>
          ) : null}
          {hovercard && hovercardPerson ? (
            <Hovercard
              person={hovercardPerson}
              viewer={viewer}
              roster={roster}
              anchor={{
                x: hovercard.anchor.x - stageRectRef.current.x,
                y: hovercard.anchor.y - stageRectRef.current.y,
                width: hovercard.anchor.width,
                height: hovercard.anchor.height,
              }}
              stageSize={{
                width: stageRectRef.current.width,
                height: stageRectRef.current.height,
              }}
              onHoverIn={handleHovercardHoverIn}
              onHoverOut={handleHovercardHoverOut}
              onMeasured={(rect) => {
                hovercardRectRef.current = rect;
              }}
            />
          ) : null}
        </View>
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
  type: ParticipationType;
  label: string;
  fillable: boolean;
  highlighted: boolean;
  // Outside the viewer's ceiling for the person being dragged.
  dimmed: boolean;
  people: Person[];
  viewer: RosterPaneProps["viewer"];
  roster: RosterPaneProps["roster"];
  selectedId: number | undefined;
  draggingPersonId: number | undefined;
  onOpen: (personId: number) => void;
  openMenuFor: number | undefined;
  onMenuOpenChange: (personId: number, open: boolean) => void;
  onRect: (type: ParticipationType, rect: Rect) => void;
  onDragStart: (person: Person, clientX: number, clientY: number) => void;
  onCardHoverIn: (personId: number) => void;
  onCardHoverOut: (personId: number) => void;
  registerCardRef: (personId: number) => (el: View | null) => void;
}

function Column(props: ColumnProps) {
  const {
    type,
    label,
    fillable,
    highlighted,
    dimmed,
    people,
    viewer,
    roster,
    selectedId,
    draggingPersonId,
    onOpen,
    openMenuFor,
    onMenuOpenChange,
    onRect,
    onDragStart,
    onCardHoverIn,
    onCardHoverOut,
    registerCardRef,
  } = props;
  const theme = useTheme();
  const ref = useRef<View>(null);
  return (
    <View
      ref={ref}
      onLayout={() =>
        ref.current?.measureInWindow((x, y, width, height) =>
          onRect(type, { x, y, width, height }),
        )
      }
      style={[
        styles.column,
        {
          minWidth: MIN_COLUMN_WIDTH,
          backgroundColor: highlighted
            ? theme.colors.surfaceRaised
            : theme.colors.surfaceSunken,
          borderRadius: theme.radii.lg,
          borderColor: highlighted ? theme.colors.borderStrong : "transparent",
          opacity: dimmed ? DIMMED_COLUMN_OPACITY : 1,
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
                beingDragged={person.personId === draggingPersonId}
                onPress={() => onOpen(person.personId)}
                onMenuOpenChange={(open) =>
                  onMenuOpenChange(person.personId, open)
                }
                onDragStart={onDragStart}
                onHoverIn={() => onCardHoverIn(person.personId)}
                onHoverOut={() => onCardHoverOut(person.personId)}
                cardRef={registerCardRef(person.personId)}
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
  beingDragged: boolean;
  onPress: () => void;
  onMenuOpenChange: (open: boolean) => void;
  onDragStart: (person: Person, clientX: number, clientY: number) => void;
  onHoverIn: () => void;
  onHoverOut: () => void;
  cardRef: (el: View | null) => void;
}

function Card(props: CardProps) {
  const {
    person,
    viewer,
    roster,
    selected,
    beingDragged,
    onPress,
    onMenuOpenChange,
    onDragStart,
    onHoverIn,
    onHoverOut,
    cardRef,
  } = props;
  const theme = useTheme();
  const rungs = rungsFor(viewer, person);
  const label = person.name || person.handle || `Person #${person.personId}`;
  const dimmed = !person.hasPassword || beingDragged;

  return (
    // Not role="button": RN Web renders that as <button>, and this row holds
    // the role menu's and the grip's own buttons (09aa finding).
    <Pressable
      ref={cardRef}
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
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
            },
          ]}
        >
          <View style={styles.cardBody}>
            {rungs.length > 0 ? (
              <Grip
                onPointerDown={(clientX, clientY) =>
                  onDragStart(person, clientX, clientY)
                }
              />
            ) : null}
            <View style={[styles.cardContent, { gap: theme.spacing.xs }]}>
              <CardContent person={person} />
              <MoveMenu
                person={person}
                rungs={rungs}
                onSelect={(rung) => void roster.setRole(person.personId, rung)}
                pending={roster.pendingFor(person.personId)}
                error={roster.errorFor(person.personId)?.message}
                onOpenChange={onMenuOpenChange}
              />
            </View>
          </View>
        </PressFeedback>
      )}
    </Pressable>
  );
}

/** The card's own content — the avatar row and the crew chips — shared with the drag's ghost (§ The drag: "same Card body"). */
function CardContent(props: { person: Person }) {
  const { person } = props;
  const theme = useTheme();
  const label = person.name || person.handle || `Person #${person.personId}`;
  return (
    <>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Avatar person={person} size={32} />
        <View style={{ flexShrink: 1 }}>
          <View style={[styles.row, { gap: theme.spacing.xs }]}>
            <Text variant="label" numberOfLines={1}>
              {label}
            </Text>
            {person.isAdmin ? <Badge label="Admin" tone="restricted" /> : null}
          </View>
          {person.handle && person.name ? (
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {person.handle}
            </Text>
          ) : null}
        </View>
      </View>
      {person.crews.length > 0 ? (
        <View style={[styles.row, { flexWrap: "wrap", gap: theme.spacing.xs }]}>
          {person.crews.map((c) => (
            <Badge
              key={c.crewSlug}
              label={c.isLeader ? `${c.crewName} · leads` : c.crewName}
              tone={c.isLeader ? "info" : "neutral"}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

/**
 * The drag's pick-up control (§ The drag): a strip at the card's left edge,
 * pointer-only — native touch drag is Gesture Handler's job (see the file
 * header). `cursor: "grab"` does not type: `CursorValue` is
 * `"auto" | "pointer"` only (checked against `StyleSheetTypes.d.ts`), so per
 * the brief's own fallback it is skipped rather than cast around.
 */
function Grip(props: {
  onPointerDown: (clientX: number, clientY: number) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Drag to move"
      onPointerDown={(e: RNPointerEvent) => {
        e.stopPropagation();
        // Cancels the compatibility mousedown, which would start a native
        // text selection that then follows the drag across the columns.
        e.preventDefault();
        props.onPointerDown(e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      pressRetentionOffset={pressRetentionOffset}
      style={styles.grip}
    >
      {({ pressed }) => (
        <PressFeedback pressed={pressed} style={styles.gripFill}>
          <Text variant="label" color="textMuted" aria-hidden>
            ⋮⋮
          </Text>
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
 * "Move to…", the Ladder's twin to the drag (§ The drag: "the menu stays as
 * the twin"): a hard-cut list of the rungs `rungsFor` offers, same mechanics
 * as `RoleMenu` (open/close with no animation, `stopPropagation` so the
 * card's own press — which opens the hovercard — never also fires) but its
 * own trigger, since the brief's control reads "Move to…" rather than the
 * current rung.
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
  stageWrap: { flex: 1 },
  stage: { flexDirection: "row", alignItems: "flex-start" },
  column: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  columnHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardBody: { flexDirection: "row", alignItems: "stretch" },
  cardContent: { flex: 1, minWidth: 0 },
  raisedCard: { zIndex: 1 },
  ghost: { pointerEvents: "none" },
  row: { flexDirection: "row", alignItems: "center" },
  grip: {
    width: GRIP_WIDTH,
    minHeight: touchTarget,
  },
  gripFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  dragOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
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
