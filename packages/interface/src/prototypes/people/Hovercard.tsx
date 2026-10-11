// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/design/theme";
import { touchTarget } from "@/design/tokens";
import { ProfileCard } from "@/prototypes/people/ProfileCard";
import type { Viewer } from "@/prototypes/people/types";
import type { Roster } from "@/prototypes/people/useRoster";

// The hovercard (the 3c.4 round's second cut, replacing the person drawer
// for the Ladder): `ProfileCard`'s own content in a popover anchored to the
// card, rather than a side panel — the round's other ask, alongside the
// drag. Positioning is plain arithmetic against two rects the caller already
// has (the anchor card's, the stage's), both in "stage-local" coordinates
// (the caller subtracts the stage's own window offset first) so this file
// never has to know about the window.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HovercardProps {
  person: Person;
  viewer: Viewer;
  roster: Roster;
  /** The anchor card's rect, already stage-local. */
  anchor: Rect;
  /** The stage's own size, for clamping. */
  stageSize: { width: number; height: number };
  /** Keeps the card open while the pointer is over the popover itself. */
  onHoverIn: () => void;
  onHoverOut: () => void;
  /** Reports this popover's own on-screen (window) rect, for the caller's outside-press check. */
  onMeasured: (rect: Rect) => void;
}

/**
 * Enough room for a compact card even hard-clamped to the stage's bottom
 * edge — a multiple of the touch target rather than a bare literal (the
 * Ladder's own `MIN_COLUMN_WIDTH` is the precedent).
 */
const MIN_VISIBLE_HEIGHT = touchTarget * 4;

export function Hovercard(props: HovercardProps) {
  const {
    person,
    viewer,
    roster,
    anchor,
    stageSize,
    onHoverIn,
    onHoverOut,
    onMeasured,
  } = props;
  const theme = useTheme();
  const ref = useRef<View>(null);

  const width = theme.spacing.xl * 16;
  const gap = theme.spacing.sm;
  const margin = theme.spacing.md;

  let left = anchor.x + anchor.width + gap;
  if (left + width + margin > stageSize.width) {
    left = anchor.x - width - gap;
  }
  left = Math.min(
    Math.max(left, margin),
    Math.max(margin, stageSize.width - width - margin),
  );

  const top = Math.max(
    margin,
    Math.min(anchor.y, stageSize.height - margin - MIN_VISIBLE_HEIGHT),
  );
  const maxHeight = Math.max(
    MIN_VISIBLE_HEIGHT,
    stageSize.height - top - margin,
  );

  return (
    <View
      ref={ref}
      onLayout={() =>
        ref.current?.measureInWindow((x, y, w, h) =>
          onMeasured({ x, y, width: w, height: h }),
        )
      }
      // Not a Pressable: this popover isn't itself a press target, and
      // `onHoverIn`/`onHoverOut` type only on `Pressable` (checked against
      // `Pressable.d.ts`'s own `PressableBaseProps`) — `onPointerEnter`/
      // `onPointerLeave` are `View`'s own typed pointer props instead
      // (`ViewPropTypes.d.ts`'s `PointerEventProps`) and carry the same
      // hover information here.
      onPointerEnter={onHoverIn}
      onPointerLeave={onHoverOut}
      style={[
        styles.card,
        theme.elevation[2],
        {
          left,
          top,
          width,
          maxHeight,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.borderStrong,
          borderRadius: theme.radii.lg,
        },
      ]}
      testID={`people-hovercard-${person.personId}`}
    >
      <ProfileCard person={person} viewer={viewer} roster={roster} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});
