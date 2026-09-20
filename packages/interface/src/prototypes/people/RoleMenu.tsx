// SPDX-License-Identifier: Apache-2.0

import type {
  ParticipationType,
  Person,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { AppError } from "@/api/errors";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { rungLabel } from "@/prototypes/people/roles";

// The roster's one edit (docs/plans/09aa-roster-design.md § What is fixed):
// the rungs `rungsFor` offers, the current one marked, a press writes
// through `setRole` at once (no confirm — a change within the ceiling
// writes on pick, templ's rule). A hard cut: the list appears and
// disappears, nothing slides or fades open (§ Keyboard, motion, the phone).
// Absent rungs (a writer's/crew leader's row for an inviter) render as a
// label — no menu is the tell that the server would refuse everything.

export interface RoleMenuProps {
  person: Person;
  rungs: ParticipationType[];
  onSelect: (rung: ParticipationType) => void;
  pending?: boolean;
  error?: AppError;
  testID?: string;
  /** Told when the menu opens or closes, so the row/card can raise itself above its neighbours (09aa fix: the row below was painting over the open menu). */
  onOpenChange?: (open: boolean) => void;
}

export function RoleMenu(props: RoleMenuProps) {
  const {
    person,
    rungs,
    onSelect,
    pending = false,
    error,
    testID,
    onOpenChange,
  } = props;
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const current = person.participationType;

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  if (rungs.length === 0) {
    return (
      <Text variant="label" color="textMuted" testID={testID}>
        {rungLabel(current)}
      </Text>
    );
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change role, currently ${rungLabel(current)}`}
        accessibilityState={{ expanded: open, busy: pending }}
        onPress={(e) => {
          // Sits on a table row that opens the card on its own press (web
          // click bubbling) — this stops the row from hearing it too.
          e.stopPropagation();
          setOpenState(!open);
        }}
        pressRetentionOffset={pressRetentionOffset}
        testID={testID}
      >
        {({ pressed }) => (
          <PressFeedback pressed={pressed} style={styles.trigger}>
            <Text variant="label" color={pending ? "textMuted" : "text"}>
              {rungLabel(current)}
            </Text>
            <Text variant="label" color="textMuted" aria-hidden>
              ▾
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
          testID={testID ? `${testID}-menu` : undefined}
        >
          {rungs.map((rung) => {
            const selected = rung === current;
            return (
              <Pressable
                key={rung}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                onPress={(e) => {
                  e.stopPropagation();
                  setOpenState(false);
                  onSelect(rung);
                }}
                pressRetentionOffset={pressRetentionOffset}
                testID={testID ? `${testID}-option-${rung}` : undefined}
              >
                {({ pressed }) => (
                  <PressFeedback
                    pressed={pressed}
                    style={[
                      styles.option,
                      {
                        paddingHorizontal: theme.spacing.md,
                        backgroundColor: selected
                          ? theme.colors.surfaceRaised
                          : "transparent",
                      },
                    ]}
                  >
                    <Text variant="label" color={selected ? "primary" : "text"}>
                      {rungLabel(rung)}
                    </Text>
                  </PressFeedback>
                )}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {error ? (
        <Text
          variant="caption"
          color="danger"
          testID={testID ? `${testID}-error` : undefined}
        >
          {error.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: touchTarget - 12,
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
