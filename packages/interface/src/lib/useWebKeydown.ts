// SPDX-License-Identifier: Apache-2.0

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";

// The one keyboard-listener primitive (plan 09x criterion 11; D2 round
// finding 2): web only, and gated on `useFocusEffect`, because a page pushed
// on top of a screen leaves it mounted beneath and two ungated listeners
// fight. Modifier combos (meta/ctrl/alt) are ignored. While an input has
// focus only Escape is delivered, with `inInput` true so the caller can blur
// it. The handler is read through a ref: it may close over fresh state
// without re-subscribing.

export function useWebKeydown(
  handler: (e: KeyboardEvent, inInput: boolean) => void,
): void {
  const focused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return undefined;
    }
    const onKey = (e: KeyboardEvent) => {
      if (!focused.current || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const inInput =
        target !== null &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.isContentEditable);
      if (inInput && e.key !== "Escape") {
        return;
      }
      latest.current(e, inInput);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
