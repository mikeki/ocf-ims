// SPDX-License-Identifier: Apache-2.0

import type { ReportView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FlatList, TextInput } from "react-native";
import {
  applyQuery,
  bareNumber,
  type LinkFilter,
  type Params,
  parseQuery,
  type Query,
  type Row,
  serializeQuery,
  toRows,
} from "@/prototypes/reports/reportQuery";

// The report table's URL state and its actions, a retyped copy of
// src/features/dispatch/useDispatchQuery.ts: no stored preference (the
// incident table's "state" chip remembers across sessions; the round's brief
// does not ask the same of "link", so every mount starts at the default,
// Unlinked). Note 09y finding 1: the caller mounts this a render after the
// rows are in — `setParams` must never run before the root layout has.

export interface ReportQuery {
  query: Query;
  visible: Row[];
  selected: Row | undefined;
  opened: Row | undefined;
  searchRef: RefObject<TextInput | null>;
  listRef: RefObject<FlatList<Row> | null>;
  setQuery: (patch: Partial<Query>) => void;
  setLink: (link: LinkFilter) => void;
  select: (number: number | undefined) => void;
  open: (number: number) => void;
  close: () => void;
  move: (delta: 1 | -1) => void;
  submitSearch: () => void;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function useReportQuery(
  reports: ReportView[],
  /** Have the reports loaded at least once? Default true for callers that don't poll. */
  loaded = true,
): ReportQuery {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Row>>(null);

  const flat = useMemo(() => {
    const out: Params = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] = first(v);
    }
    return out;
  }, [params]);

  const query = useMemo(() => parseQuery(flat), [flat]);
  const visible = useMemo(() => applyQuery(reports, query), [reports, query]);

  // Selection and "open" resolve against every loaded row, not just the
  // currently-visible ones — a filter change must not silently drop them.
  const byNumber = useMemo(() => {
    const map = new Map<number, Row>();
    for (const row of toRows(reports)) {
      map.set(row.report.number, row);
    }
    return map;
  }, [reports]);
  const selected =
    query.sel === undefined ? undefined : byNumber.get(query.sel);
  const opened =
    query.open === undefined ? undefined : byNumber.get(query.open);

  // Every change here is a param update on the SAME screen: `router.replace`
  // would remount it, dropping the search focus and the scroll (09x finding 1).
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

  const setLink = useCallback(
    (link: LinkFilter) => setQuery({ link }),
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
      const index = visible.findIndex((row) => row.report.number === query.sel);
      const nextIndex =
        index === -1
          ? delta === 1
            ? 0
            : visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, index + delta));
      const number = visible[nextIndex]?.report.number;
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
      // A bare number plus Enter jumps to that report (templ's rule).
      searchRef.current?.blur();
      open(number);
      return;
    }
    // Otherwise Enter hands focus to the table so j/k walk it.
    searchRef.current?.blur();
    if (query.sel === undefined && visible[0]) {
      select(visible[0].report.number);
    }
  }, [query.q, query.sel, byNumber, open, visible, select]);

  // `open` implies `sel`: a link with only `open=` selects that row too; a
  // stale `sel` from before a filter change is normalised in place, never
  // pushed. Once the rows have loaded, an `open` that resolves to no row is
  // stale, not a value to keep normalising toward — the URL keys pointing at
  // it are cleared instead (09x finding 6).
  useEffect(() => {
    const openNumber = query.open;
    if (openNumber === undefined) {
      return;
    }
    if (loaded && !byNumber.has(openNumber)) {
      setQuery({ open: undefined, sel: undefined });
    } else if (query.sel !== openNumber) {
      setQuery({ sel: openNumber });
    }
  }, [query.open, query.sel, loaded, byNumber, setQuery]);

  return {
    query,
    visible,
    selected,
    opened,
    searchRef,
    listRef,
    setQuery,
    setLink,
    select,
    open,
    close,
    move,
    submitSearch,
  };
}
