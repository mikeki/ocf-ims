// SPDX-License-Identifier: Apache-2.0

import { useFocusEffect } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Platform, type TextInput } from "react-native";
import type { Query, Row } from "@/features/dispatch/query";
import type { IncidentScreenHandle } from "@/features/incidents/IncidentScreen";

// The dispatch keyboard map (plan 09x criterion 11), promoted from
// src/prototypes/dispatch/useDispatch.ts: web only, and gated on
// `useFocusEffect` (finding 2 of the D2 round — a page pushed on top of this
// screen leaves it mounted beneath, and two ungated listeners fight over the
// URL). Suppressed while an input has focus, except Esc, which blurs it.
//
// One hook, two callers (criterion 9): the dispatch table passes every field;
// `IncidentPage` (criterion 9) passes a narrower set — no search field, no
// "new incident", `close` is its "back" — so `setQuery`/`select`/`open`/
// `onFull`/`onNewIncident`/`searchRef` are optional. `query.open` is what
// both callers use to say "an incident is showing": the drawer sets it only
// while open, the page holds it fixed to the incident it shows, which is
// also what gates `a`/`h` below. `m` is not bound (no multi-event search
// yet, 09x); `p`/`P` die with the surface.

export interface KeyboardMapDeps {
  query: Pick<Query, "open" | "sel" | "q">;
  visible: Row[];
  help: boolean;
  setHelp: (on: boolean) => void;
  setQuery?: (patch: Partial<Query>) => void;
  select?: (number: number | undefined) => void;
  open?: (number: number) => void;
  /** Closes the drawer (the table) or goes back (the page). */
  close: () => void;
  move: (delta: 1 | -1) => void;
  /** Drawer open, Enter again: the full page. Absent on the page — there is nowhere further to go. */
  onFull?: () => void;
  /** Absent when the caller may not write incidents, or on the page (not bound there). */
  onNewIncident?: () => void;
  /** Absent on the page: no search field there. */
  searchRef?: RefObject<TextInput | null>;
  /** The open incident's composer / system-entries controls (criteria 8, 9); bound while `query.open` is set. */
  handle?: RefObject<IncidentScreenHandle | null>;
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
          d.select?.(undefined);
        } else if (d.query.q) {
          d.setQuery?.({ q: "" });
        }
        return;
      }
      if (inInput) {
        return;
      }
      switch (e.key) {
        case "/":
          e.preventDefault();
          d.searchRef?.current?.focus();
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
            d.onFull?.();
          } else if (d.query.sel !== undefined) {
            d.open?.(d.query.sel);
          } else {
            d.move(1);
          }
          break;
        case "n":
          d.onNewIncident?.();
          break;
        case "a":
          if (d.query.open !== undefined) {
            e.preventDefault();
            d.handle?.current?.focusComposer();
          }
          break;
        case "h":
          if (d.query.open !== undefined) {
            d.handle?.current?.toggleSystemEntries();
          }
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
