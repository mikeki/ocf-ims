// SPDX-License-Identifier: Apache-2.0

import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlatList, TextInput } from "react-native";
import { Platform } from "react-native";
import {
  areas,
  buildIncidents,
  ME,
  me,
  types,
} from "@/prototypes/dispatch/data";
import {
  applyQuery,
  bareNumber,
  type Lookups,
  type Params,
  parseQuery,
  type Query,
  serializeQuery,
} from "@/prototypes/dispatch/state";
import { makeJournalEntry } from "@/test/fixtures";

// The one state machine behind the three variants (plan 09x): the query
// parsed from the URL, the cached list with live pokes patched into it, the
// selection, and the keyboard map. A variant only decides what "open" means.

export type Variant = "split" | "drawer" | "page";

/** Query keys that belong to the harness, carried through every navigation. */
export const HARNESS_KEYS = ["v", "shell", "w", "scheme", "density"] as const;

export interface Dispatch {
  variant: Variant;
  query: Query;
  rows: Incident[];
  visible: Incident[];
  lookups: Lookups;
  selected: Incident | undefined;
  opened: Incident | undefined;
  showSystem: boolean;
  help: boolean;
  notice: string | undefined;
  searchRef: RefObject<TextInput | null>;
  composerRef: RefObject<TextInput | null>;
  listRef: RefObject<FlatList<Incident> | null>;
  setQuery: (patch: Partial<Query>) => void;
  select: (number: number | undefined) => void;
  open: (number: number) => void;
  /** The drawer's incident as a full page: a push, so back returns to the drawer. */
  openFull: () => void;
  close: () => void;
  move: (delta: 1 | -1) => void;
  poke: (target: "other" | "selected") => void;
  toggleSystem: () => void;
  setHelp: (on: boolean) => void;
  notify: (text: string) => void;
  submitSearch: () => void;
}

const lookups: Lookups = { types, areas };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function useDispatch(variant: Variant): Dispatch {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const now = useRef(Date.now()).current;
  const [rows, setRows] = useState<Incident[]>(() => buildIncidents(now));
  const [showSystem, setShowSystem] = useState(false);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState<string>();
  const searchRef = useRef<TextInput>(null);
  const composerRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Incident>>(null);
  // The Page pushes a second copy of this screen on top of the first, and
  // the first stays mounted beneath it: only the focused one may own the
  // keyboard, or every key is handled twice.
  const focused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

  const flat = useMemo(() => {
    const out: Params = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] = first(v);
    }
    return out;
  }, [params]);
  const query = useMemo(() => parseQuery(flat), [flat]);
  const visible = useMemo(
    () => applyQuery(rows, query, lookups, ME, now),
    [rows, query, now],
  );
  const byNumber = useMemo(
    () => new Map(rows.map((row) => [row.number, row])),
    [rows],
  );
  const selected =
    query.sel === undefined ? undefined : byNumber.get(query.sel);
  // In Split the pane follows the selection; elsewhere "open" is its own key.
  const opened =
    variant === "split"
      ? selected
      : query.open === undefined
        ? undefined
        : byNumber.get(query.open);

  // Every navigation but the Page's open is a param update on the SAME
  // screen: `replace` would mount a new one, dropping the search focus, the
  // scroll and the pokes. Absent keys are passed as `undefined` so a stale
  // key clears; the harness keys ride along untouched.
  const navigate = useCallback(
    (next: Query, mode: "replace" | "push") => {
      const serialized = serializeQuery(next);
      if (mode === "replace") {
        router.setParams(serialized as never);
        return;
      }
      // The pushed href starts from the live params so nothing the table
      // holds is lost on the way into the page.
      const merged: Record<string, string> = {};
      for (const [k, v] of Object.entries({ ...flat, ...serialized })) {
        if (v !== undefined) {
          merged[k] = v;
        }
      }
      router.push({ pathname: "/dispatch", params: merged } as never);
    },
    [flat, router],
  );

  const setQuery = useCallback(
    (patch: Partial<Query>) => navigate({ ...query, ...patch }, "replace"),
    [navigate, query],
  );

  const select = useCallback(
    (number: number | undefined) => setQuery({ sel: number }),
    [setQuery],
  );

  const open = useCallback(
    (number: number) => {
      if (variant === "split") {
        // The pane already follows the selection: "open" is the composer.
        select(number);
        composerRef.current?.focus();
        return;
      }
      // Page pushes so the browser's back returns to the table; Drawer
      // replaces, since Esc is its back.
      navigate(
        { ...query, sel: number, open: number },
        variant === "page" ? "push" : "replace",
      );
    },
    [variant, select, navigate, query],
  );

  const openFull = useCallback(() => {
    if (query.open === undefined || query.full) {
      return;
    }
    navigate({ ...query, full: true }, "push");
  }, [query, navigate]);

  // What was pushed pops; what was set in place is unset in place.
  const close = useCallback(() => {
    const pushed =
      (variant === "page" && query.open !== undefined) ||
      (variant === "drawer" && query.full);
    if (pushed && router.canGoBack()) {
      router.back();
      return;
    }
    if (query.full) {
      setQuery({ full: false });
      return;
    }
    setQuery({ open: undefined });
  }, [variant, query.open, query.full, router, setQuery]);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (visible.length === 0) {
        return;
      }
      const index = visible.findIndex((row) => row.number === query.sel);
      const next =
        index === -1
          ? delta === 1
            ? 0
            : visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, index + delta));
      const number = visible[next]?.number;
      if (number === undefined) {
        return;
      }
      // With something open, walking the table walks what is open too.
      if (variant !== "split" && query.open !== undefined) {
        navigate({ ...query, sel: number, open: number }, "replace");
      } else {
        select(number);
      }
    },
    [visible, query, variant, navigate, select],
  );

  const notify = useCallback((text: string) => setNotice(text), []);
  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const id = setTimeout(() => setNotice(undefined), 2500);
    return () => clearTimeout(id);
  }, [notice]);

  /**
   * A live poke (09x § Live rows): patch one row in the cached list, never
   * refetch the table, never touch the selection or the scroll. "other"
   * picks a visible row that is not the selected one — the brief's case.
   */
  const poke = useCallback(
    (target: "other" | "selected") => {
      const pool =
        target === "selected"
          ? selected
            ? [selected]
            : []
          : visible.filter((row) => row.number !== query.sel);
      const victim = pool[Math.floor(Math.random() * pool.length)];
      if (!victim) {
        notify(
          target === "selected"
            ? "Nothing selected to poke"
            : "No other row to poke",
        );
        return;
      }
      const stamp = timestampFromDate(new Date());
      const roll = Math.random();
      setRows((all) =>
        all.map((row) => {
          if (row.number !== victim.number) {
            return row;
          }
          const entry = makeJournalEntry({
            id: 100_000 + Math.floor(Math.random() * 1_000_000),
            created: stamp,
            author: me.handle ?? "Dee",
            text:
              roll < 0.33
                ? "Priority raised to high — second caller on scene."
                : roll < 0.66
                  ? "Update by radio: situation contained."
                  : "Closed by dispatch.",
          });
          return {
            ...row,
            lastModified: stamp,
            priority: roll < 0.33 ? IncidentPriority.HIGH : row.priority,
            state: roll >= 0.66 ? IncidentState.CLOSED : row.state,
            journalEntries: [...row.journalEntries, entry],
          };
        }),
      );
      notify(`Poke: #${victim.number} changed`);
    },
    [selected, visible, query.sel, notify],
  );

  const submitSearch = useCallback(() => {
    const number = bareNumber(query.q);
    if (number !== undefined && byNumber.has(number)) {
      // A bare number plus Enter jumps to that incident (templ's rule).
      open(number);
      if (variant === "split") {
        setQuery({ sel: number, q: "" });
      }
      return;
    }
    // Otherwise Enter hands focus to the table so j/k walk it.
    searchRef.current?.blur();
    if (query.sel === undefined && visible[0]) {
      select(visible[0].number);
    }
  }, [query.q, query.sel, byNumber, open, variant, setQuery, visible, select]);

  const toggleSystem = useCallback(() => setShowSystem((on) => !on), []);

  // The keyboard map (09x § Keyboard), web only, suppressed while an input
  // has focus — except Esc, which blurs it.
  const latest = useRef({
    query,
    open,
    openFull,
    close,
    move,
    select,
    poke,
    toggleSystem,
    notify,
    help,
    setQuery,
  });
  latest.current = {
    query,
    open,
    openFull,
    close,
    move,
    select,
    poke,
    toggleSystem,
    notify,
    help,
    setQuery,
  };
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return undefined;
    }
    const onKey = (e: KeyboardEvent) => {
      if (!focused.current) {
        return;
      }
      const s = latest.current;
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
        } else if (s.help) {
          setHelp(false);
        } else if (s.query.open !== undefined) {
          s.close();
        } else if (s.query.sel !== undefined) {
          s.select(undefined);
        } else if (s.query.q) {
          s.setQuery({ q: "" });
        }
        return;
      }
      if (inInput) {
        return;
      }
      switch (e.key) {
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          s.move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          s.move(-1);
          break;
        case "Enter":
          // Drawer: Enter opens the drawer, Enter again the full page.
          if (variant === "drawer" && s.query.open !== undefined) {
            s.openFull();
          } else if (s.query.sel !== undefined) {
            s.open(s.query.sel);
          } else {
            s.move(1);
          }
          break;
        case "n":
          s.notify("New incident — the editor lands with 3c.2");
          break;
        case "m":
          s.notify(
            "Multi-event search — a feature of the search box, not built here",
          );
          break;
        case "a":
          composerRef.current?.focus();
          break;
        case "h":
          s.toggleSystem();
          break;
        case "p":
          s.poke("other");
          break;
        case "P":
          s.poke("selected");
          break;
        case "?":
          setHelp((on) => !on);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  return {
    variant,
    query,
    rows,
    visible,
    lookups,
    selected,
    opened,
    showSystem,
    help,
    notice,
    searchRef,
    composerRef,
    listRef,
    setQuery,
    select,
    open,
    openFull,
    close,
    move,
    poke,
    toggleSystem,
    setHelp,
    notify,
    submitSearch,
  };
}
