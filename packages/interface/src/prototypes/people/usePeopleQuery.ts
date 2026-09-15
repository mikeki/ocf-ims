// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useMemo, useRef } from "react";
import type { TextInput } from "react-native";
import {
  type Params,
  parseQuery,
  type Query,
  visiblePeople,
} from "@/prototypes/people/peopleQuery";

// The roster's URL state and its actions, a retyped copy of
// useReportQuery.ts: no `move` here (§ Keyboard) — a person's display order
// is variant-specific (a section, a column, the alphabet), so each variant
// walks its own order with usePeopleKeyboardMap rather than a shared one.

export interface PeopleQuery {
  query: Query;
  visible: Person[];
  selected: Person | undefined;
  opened: Person | undefined;
  searchRef: RefObject<TextInput | null>;
  setQuery: (patch: Partial<Query>) => void;
  select: (personId: number | undefined) => void;
  open: (personId: number) => void;
  close: () => void;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function usePeopleQuery(people: Person[]): PeopleQuery {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const searchRef = useRef<TextInput>(null);

  const flat = useMemo(() => {
    const out: Params = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] = first(v);
    }
    return out;
  }, [params]);

  const query = useMemo(() => parseQuery(flat), [flat]);
  const visible = useMemo(() => visiblePeople(people, query), [people, query]);

  const byId = useMemo(() => {
    const map = new Map<number, Person>();
    for (const p of people) {
      map.set(p.personId, p);
    }
    return map;
  }, [people]);
  const selected = query.sel === undefined ? undefined : byId.get(query.sel);
  const opened = query.open === undefined ? undefined : byId.get(query.open);

  // Every change here is a param update on the SAME screen (09x finding 1):
  // `router.replace` would remount it, dropping the search field's focus.
  const navigate = useCallback(
    (next: Query) => {
      router.setParams({
        q: next.q || undefined,
        sel: next.sel === undefined ? undefined : String(next.sel),
        open: next.open === undefined ? undefined : String(next.open),
      } as never);
    },
    [router],
  );

  const setQuery = useCallback(
    (patch: Partial<Query>) => navigate({ ...query, ...patch }),
    [navigate, query],
  );

  const select = useCallback(
    (personId: number | undefined) => setQuery({ sel: personId }),
    [setQuery],
  );

  const open = useCallback(
    (personId: number) => navigate({ ...query, sel: personId, open: personId }),
    [navigate, query],
  );

  const close = useCallback(() => setQuery({ open: undefined }), [setQuery]);

  return {
    query,
    visible,
    selected,
    opened,
    searchRef,
    setQuery,
    select,
    open,
    close,
  };
}
