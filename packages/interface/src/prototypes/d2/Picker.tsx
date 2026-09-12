// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  cubicBezier,
  useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// The prototype picker from the `prototype` skill's PICKER.md, in React
// Native: harness chrome, deliberately NOT on the app's tokens. Top position
// because a docked composer owns the bottom of one variant.

export interface PickerProps {
  names: string[];
  current: number;
  onSelect: (index: number) => void;
}

interface Slot {
  x: number;
  width: number;
}

const easeOut = cubicBezier(0.23, 1, 0.32, 1);

export function Picker(props: PickerProps) {
  const { names, current, onSelect } = props;
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [slots, setSlots] = useState<Record<number, Slot>>({});
  const [ready, setReady] = useState(false);

  // The slide is enabled only after first paint, so load doesn't animate.
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return undefined;
    }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const num = Number.parseInt(e.key, 10);
      if (num >= 1 && num <= names.length) {
        onSelect(num - 1);
      } else if (e.key === "ArrowRight") {
        onSelect((current + 1) % names.length);
      } else if (e.key === "ArrowLeft") {
        onSelect((current - 1 + names.length) % names.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [names.length, current, onSelect]);

  const slot = slots[current];
  return (
    <View
      pointerEvents="box-none"
      style={[styles.anchor, { top: 24 + insets.top }]}
    >
      <View accessibilityRole="toolbar" style={styles.pill}>
        {slot ? (
          <Animated.View
            aria-hidden
            style={[
              styles.highlight,
              {
                width: slot.width,
                transform: [{ translateX: slot.x }],
                transitionProperty:
                  ready && !reduced ? ["transform", "width"] : undefined,
                transitionDuration: 250,
                transitionTimingFunction: easeOut,
              },
            ]}
          />
        ) : null}
        {names.map((name, i) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityState={{ selected: i === current }}
            aria-current={i === current ? "true" : undefined}
            onPress={() => onSelect(i)}
            onLayout={(e) => {
              const { x, width } = e.nativeEvent.layout;
              setSlots((all) => ({ ...all, [i]: { x, width } }));
            }}
            style={({ pressed }) => [
              styles.item,
              pressed ? { transform: [{ scale: 0.97 }] } : null,
            ]}
            testID={`proto-picker-${i + 1}`}
          >
            <Text
              style={[
                styles.label,
                { color: i === current ? "#fff" : "rgba(255,255,255,0.55)" },
              ]}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 2147483647,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    padding: 4,
    borderRadius: 999,
    backgroundColor: "rgba(10, 10, 10, 0.82)",
    boxShadow:
      "0 0 0 1px rgba(255, 255, 255, 0.08) inset, 0 8px 24px rgba(0, 0, 0, 0.24), 0 2px 6px rgba(0, 0, 0, 0.12)",
    userSelect: "none",
  },
  highlight: {
    position: "absolute",
    top: 4,
    left: 0,
    height: 28,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  item: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 999,
    justifyContent: "center",
  },
  label: {
    fontSize: 13,
    lineHeight: 13,
  },
});
