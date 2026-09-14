// SPDX-License-Identifier: Apache-2.0

import { useFocusEffect } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Platform, type TextInput } from "react-native";
import type { Query } from "@/prototypes/people/peopleQuery";

// The roster's keyboard map, a retyped copy of reports' useKeyboardMap.ts:
// web only, gated on useFocusEffect (09x finding 2), suppressed while an
// input has focus except Esc. `order` is the person ids in THIS variant's
// own display order (a section, a column, the alphabet — decision 4), so
// `j`/`k` stay generic here and variant-specific at the call site.

export interface PeopleKeyboardMapDeps {
  order: number[];
  query: Pick<Query, "open" | "sel" | "q">;
  help: boolean;
  setHelp: (on: boolean) => void;
  setQuery?: (patch: Partial<Query>) => void;
  select?: (personId: number | undefined) => void;
  open?: (personId: number) => void;
  close: () => void;
  onAddPerson?: () => void;
  searchRef?: RefObject<TextInput | null>;
}

export function usePeopleKeyboardMap(deps: PeopleKeyboardMapDeps): void {
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
      const move = (delta: 1 | -1) => {
        if (d.order.length === 0) {
          return;
        }
        // biome-ignore lint/complexity/useIndexOf: sel is `number | undefined`, indexOf wants a number
        const index = d.order.findIndex((id) => id === d.query.sel);
        const next =
          index === -1
            ? delta === 1
              ? 0
              : d.order.length - 1
            : Math.min(d.order.length - 1, Math.max(0, index + delta));
        const id = d.order[next];
        if (id === undefined) {
          return;
        }
        if (d.query.open !== undefined) {
          d.open?.(id);
        } else {
          d.select?.(id);
        }
      };
      switch (e.key) {
        case "/":
          e.preventDefault();
          d.searchRef?.current?.focus();
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "Enter":
          if (d.query.sel !== undefined) {
            d.open?.(d.query.sel);
          } else {
            move(1);
          }
          break;
        case "n":
          d.onAddPerson?.();
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
