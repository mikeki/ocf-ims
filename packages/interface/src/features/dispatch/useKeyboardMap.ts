// SPDX-License-Identifier: Apache-2.0

import { useFocusEffect } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Platform, type TextInput } from "react-native";
import type { Query, Row } from "@/features/dispatch/query";

// The dispatch keyboard map (plan 09x criterion 11), promoted from
// src/prototypes/dispatch/useDispatch.ts: web only, and gated on
// `useFocusEffect` (finding 2 of the D2 round — a page pushed on top of this
// screen leaves it mounted beneath, and two ungated listeners fight over the
// URL). Suppressed while an input has focus, except Esc, which blurs it.
//
// Not bound: `a` (focus the composer) and `h` (toggle system entries) —
// both would have to reach into the drawer's `IncidentScreen`, which exposes
// neither a ref nor a callback for either and is explicitly unedited this
// slice. Filed as a gap for whichever slice adds its header prop. `m` is not
// bound (no multi-event search yet, 09x); `p`/`P` die with the surface.

export interface KeyboardMapDeps {
  query: Query;
  visible: Row[];
  help: boolean;
  setHelp: (on: boolean) => void;
  setQuery: (patch: Partial<Query>) => void;
  select: (number: number | undefined) => void;
  open: (number: number) => void;
  close: () => void;
  move: (delta: 1 | -1) => void;
  /** Drawer open, Enter again: the full page (criterion 9, wired next half). */
  onFull: () => void;
  /** Absent when the caller may not write incidents: `n` does nothing. */
  onNewIncident?: () => void;
  searchRef: RefObject<TextInput | null>;
}

export function useKeyboardMap(deps: KeyboardMapDeps): void {
  const focused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

  const latest = useRef(deps);
  latest.current = deps;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return undefined;
    }
    const onKey = (e: KeyboardEvent) => {
      if (!focused.current) {
        return;
      }
      const d = latest.current;
      const target = e.target as HTMLElement | null;
      const inInput =
        target !== null &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.isContentEditable);
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      if (e.key === "Escape") {
        if (inInput) {
          target?.blur();
        } else if (d.help) {
          d.setHelp(false);
        } else if (d.query.open !== undefined) {
          d.close();
        } else if (d.query.sel !== undefined) {
          d.select(undefined);
        } else if (d.query.q) {
          d.setQuery({ q: "" });
        }
        return;
      }
      if (inInput) {
        return;
      }
      switch (e.key) {
        case "/":
          e.preventDefault();
          d.searchRef.current?.focus();
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          d.move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          d.move(-1);
          break;
        case "Enter":
          if (d.query.open !== undefined) {
            d.onFull();
          } else if (d.query.sel !== undefined) {
            d.open(d.query.sel);
          } else {
            d.move(1);
          }
          break;
        case "n":
          d.onNewIncident?.();
          break;
        case "?":
          d.setHelp(!d.help);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
