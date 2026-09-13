// SPDX-License-Identifier: Apache-2.0

import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlatList, TextInput } from "react-native";
import {
  applyQuery,
  bareNumber,
  type Lookups,
  type Params,
  parseQuery,
  type Query,
  type Row,
  type StateFilter,
  serializeQuery,
  toRows,
} from "@/features/dispatch/query";
import {
  loadStatePreference,
  saveStatePreference,
} from "@/features/dispatch/statePreference";

// The table's URL state and its actions (plan 09x criteria 6-7), promoted
// from src/prototypes/dispatch/useDispatch.ts: the pokes, the notices and the
// harness keys are gone, and the shape is fixed to the drawer the round
// picked (no split/page variant switch). `openFull` is not here — the second
// half wires the real push (criterion 9) — the caller passes its own stub as
// the drawer's "Full page" action for now. The keyboard map moved out to
// `useKeyboardMap` (finding 2 of the D2 round: a page pushed on top of this
// screen must not fight this hook's listener over the URL).

export interface DispatchQuery {
  query: Query;
  visible: Row[];
  selected: Row | undefined;
  opened: Row | undefined;
  searchRef: RefObject<TextInput | null>;
  listRef: RefObject<FlatList<Row> | null>;
  setQuery: (patch: Partial<Query>) => void;
  /** Like `setQuery({ state })`, but also remembers it (criterion 6). */
  setState: (state: StateFilter) => void;
  select: (number: number | undefined) => void;
  open: (number: number) => void;
  close: () => void;
  move: (delta: 1 | -1) => void;
  submitSearch: () => void;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function useDispatchQuery(
  rows: IncidentView[],
  lookups: Lookups,
  me: number,
): DispatchQuery {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const now = useRef(Date.now()).current;
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Row>>(null);

  // The stored state preference (criterion 6): loaded once, never written
  // back into the URL — only a chip press (`setState`) writes either.
  const [storedState, setStoredState] = useState<StateFilter>();
  const [stateLoaded, setStateLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadStatePreference(AsyncStorage)
      .catch(() => undefined)
      .then((value) => {
        if (!cancelled) {
          setStoredState(value);
          setStateLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flat = useMemo(() => {
    const out: Params = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] = first(v);
    }
    return out;
  }, [params]);

  const fallbackState: StateFilter =
    stateLoaded && storedState ? storedState : "open";
  const query = useMemo(
    () => parseQuery(flat, fallbackState),
    [flat, fallbackState],
  );

  const visible = useMemo(
    () => applyQuery(rows, query, lookups, me, now),
    [rows, query, lookups, me, now],
  );

  // Selection and "open" resolve against every loaded row, not just the
  // currently-visible ones — a filter change must not silently drop them.
  const byNumber = useMemo(() => {
    const map = new Map<number, Row>();
    for (const row of toRows(rows)) {
      map.set(row.incident.number, row);
    }
    return map;
  }, [rows]);
  const selected =
    query.sel === undefined ? undefined : byNumber.get(query.sel);
  const opened =
    query.open === undefined ? undefined : byNumber.get(query.open);

  // Every change here is a param update on the SAME screen: `router.replace`
  // would remount it, dropping the search focus and the scroll (finding 1).
  const navigate = useCallback(
    (next: Query) => {
      router.setParams(serializeQuery(next) as never);
    },
    [router],
  );

  const setQuery = useCallback(
    (patch: Partial<Query>) => navigate({ ...query, ...patch }),
    [navigate, query],
  );

  const setState = useCallback(
    (state: StateFilter) => {
      setQuery({ state });
      void saveStatePreference(AsyncStorage, state).catch(() => undefined);
    },
    [setQuery],
  );

  const select = useCallback(
    (number: number | undefined) => setQuery({ sel: number }),
    [setQuery],
  );

  const open = useCallback(
    (number: number) => navigate({ ...query, sel: number, open: number }),
    [navigate, query],
  );

  const close = useCallback(() => setQuery({ open: undefined }), [setQuery]);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (visible.length === 0) {
        return;
      }
      const index = visible.findIndex(
        (row) => row.incident.number === query.sel,
      );
      const nextIndex =
        index === -1
          ? delta === 1
            ? 0
            : visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, index + delta));
      const number = visible[nextIndex]?.incident.number;
      if (number === undefined) {
        return;
      }
      // With something open, walking the table walks what is open too.
      if (query.open !== undefined) {
        navigate({ ...query, sel: number, open: number });
      } else {
        select(number);
      }
    },
    [visible, query, navigate, select],
  );

  const submitSearch = useCallback(() => {
    const number = bareNumber(query.q);
    if (number !== undefined && byNumber.has(number)) {
      // A bare number plus Enter jumps to that incident (templ's rule).
      open(number);
      return;
    }
    // Otherwise Enter hands focus to the table so j/k walk it.
    searchRef.current?.blur();
    if (query.sel === undefined && visible[0]) {
      select(visible[0].incident.number);
    }
  }, [query.q, query.sel, byNumber, open, visible, select]);

  // `open` implies `sel` (criterion 6): a link with only `open=` selects that
  // row too; a stale `sel` from before a filter change is normalised in
  // place, never pushed.
  useEffect(() => {
    if (query.open !== undefined && query.sel !== query.open) {
      setQuery({ sel: query.open });
    }
  }, [query.open, query.sel, setQuery]);

  return {
    query,
    visible,
    selected,
    opened,
    searchRef,
    listRef,
    setQuery,
    setState,
    select,
    open,
    close,
    move,
    submitSearch,
  };
}
