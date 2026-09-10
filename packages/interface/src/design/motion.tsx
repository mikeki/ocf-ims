// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  cubicBezier,
  useReducedMotion,
} from "react-native-reanimated";
import { motion } from "@/design/tokens";

// The whole motion budget of the app, in two components (plan 09o § Motion
// and feel; DESIGN.md § Motion budget). Both are Reanimated CSS transitions:
// a state flips a style value and the transition interpolates it on the UI
// runtime — no shared value, no worklet, no re-render per frame.
//
// Nothing else animates. In particular no list row ever *enters* with an
// animation: rows recycle, and a stagger on a list people scroll all day is
// a cost paid dozens of times a session for nothing.

const easeOut = cubicBezier(...motion.easeOut);

export interface PressFeedbackProps {
  /** The `pressed` flag from a `Pressable`'s children/style callback. */
  pressed: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Press feedback: `scale(0.97)` in on press-*in*, over 120 ms, strong
 * ease-out. Rows and buttons are touched dozens of times a session, so this
 * is deliberately near-imperceptible — it exists to prove the interface
 * heard the finger, not to be noticed. Reduced motion drops the scale and
 * keeps the opacity dip, which carries the same information without moving
 * anything.
 */
export function PressFeedback(props: PressFeedbackProps) {
  const reduced = useReducedMotion();
  const scale = props.pressed && !reduced ? motion.pressScale : 1;
  return (
    <Animated.View
      style={[
        props.style,
        {
          opacity: props.pressed ? motion.pressOpacity : 1,
          transform: [{ scale }],
          transitionProperty: ["opacity", "transform"],
          transitionDuration: motion.pressDuration,
          transitionTimingFunction: easeOut,
        },
      ]}
    >
      {props.children}
    </Animated.View>
  );
}

export interface StateFadeProps {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * The one entrance in the app: an empty or error body fading in over 200 ms.
 * That is content the person waited for, so it may announce itself — opacity
 * only, no movement, which is also what reduced motion allows (there is
 * nothing to drop). Mounting at 0 and flipping in an effect is the
 * `@starting-style` pattern; a CSS *transition* rather than a keyframe
 * animation keeps it interruptible if the state changes mid-fade.
 */
export function StateFade(props: StateFadeProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  return (
    <Animated.View
      style={[
        props.style,
        {
          opacity: shown ? 1 : 0,
          transitionProperty: "opacity",
          transitionDuration: motion.stateFade,
          transitionTimingFunction: easeOut,
        },
      ]}
    >
      {props.children}
    </Animated.View>
  );
}

/**
 * The screen transition a native stack uses. Under reduced motion the
 * platform's push becomes a cross-fade (plan 09o § Motion and feel): iOS
 * does that on its own under Reduce Motion, but Android and the web build
 * do not, so the whole slide would otherwise still play for someone who
 * asked the OS for less movement. A screen push is the largest movement in
 * the app — this is the one place the setting matters most.
 */
export function useScreenAnimation(): "default" | "fade" {
  return useReducedMotion() ? "fade" : "default";
}
