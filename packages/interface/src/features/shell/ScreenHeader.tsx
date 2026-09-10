// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";

// The one header for every (app) screen (plan 09n T5): the `(app)` stack runs
// with `headerShown: false` and each screen renders this instead — one look
// on iOS, Android and web, fully covered by Jest. The back button is labelled
// with the PARENT screen's name ("Events" on the incidents screen), not
// "Back", so the tracer can find it by that accessible name.
//
// The toolbar is the one place elevation 1 is spent (DESIGN.md): it lifts off
// the list rather than ruling itself off from them. Back is a quiet text
// control in `primary`, not a filled button — the chevron is decoration and
// is hidden from assistive tech, and `accessibilityLabel` pins the accessible
// name to the parent's name whatever the glyph does.

export interface ScreenHeaderBack {
  label: string;
  onPress: () => void;
}

export interface ScreenHeaderProps {
  title: string;
  back?: ScreenHeaderBack;
  right?: ReactNode;
}

export function ScreenHeader(props: ScreenHeaderProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.bar,
        theme.elevation[1],
        {
          paddingHorizontal: theme.spacing.md,
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      {props.back ? <BackControl {...props.back} /> : null}
      <View style={styles.title}>
        <Text variant="heading" numberOfLines={1}>
          {props.title}
        </Text>
      </View>
      {props.right}
    </View>
  );
}

function BackControl(props: ScreenHeaderBack) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      pressRetentionOffset={pressRetentionOffset}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.back,
            { gap: theme.spacing.xs, paddingRight: theme.spacing.sm },
          ]}
        >
          <Text variant="heading" color="primary" aria-hidden>
            ‹
          </Text>
          <Text variant="label" color="primary">
            {props.label}
          </Text>
        </PressFeedback>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    flex: 1,
  },
  back: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
  },
});
