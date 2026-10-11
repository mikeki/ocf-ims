// SPDX-License-Identifier: Apache-2.0

import { useFocusEffect } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Platform, type TextInput } from "react-native";
import type { Query, Row } from "@/prototypes/reports/reportQuery";
import type { ReportPaneHandle } from "@/prototypes/reports/types";

// The report table's keyboard map, a retyped copy of
// src/features/dispatch/useKeyboardMap.ts (its own `handle` is pinned to
// `IncidentScreenHandle`, so it does not fit here as-is): web only, gated on
// `useFocusEffect` (09x finding 2), suppressed while an input has focus
// except Esc, which blurs it. `m` (search across events) is out of scope
// (§ The table).

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
  /** Drawer open, Enter again: the full page. Absent on the page. */
  onFull?: () => void;
  /** Absent when the caller may not write reports, or on the page. */
  onNewReport?: () => void;
  /** Absent on the page: no search field there. */
  searchRef?: RefObject<TextInput | null>;
  /** The open report's composer / system-entries controls; bound while `query.open` is set. */
  handle?: RefObject<ReportPaneHandle | null>;
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
          d.onNewReport?.();
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
