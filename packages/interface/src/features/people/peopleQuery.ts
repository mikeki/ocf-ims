// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";

// The roster's url query state (docs/plans/09aa-roster-design.md § The
// prototype round), a retyped copy of reportQuery.ts's shape: `q`, `sel`,
// `open` — no `link`/`sort` (a person carries neither), and no bare-number
// jump (a person id is never typed). Search covers the name, the handle and
// crew names; every variant runs it over the SAME `people` (decision 4 is
// each variant's own choice of grain — within a section, a column or the
// whole list — not this file's).

export interface Query {
  q: string;
  sel?: number;
  open?: number;
}

export type Params = Record<string, string | undefined>;

function int(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseQuery(params: Params): Query {
  return {
    q: params.q ?? "",
    sel: int(params.sel),
    open: int(params.open),
  };
}

/** Absent means default, so a default view is a bare URL. */
export function serializeQuery(query: Query): Params {
  return {
    q: query.q || undefined,
    sel: query.sel === undefined ? undefined : String(query.sel),
    open: query.open === undefined ? undefined : String(query.open),
  };
}

function displayName(person: Person): string {
  return person.handle || person.name || `Person #${person.personId}`;
}

export function matches(person: Person, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    displayName(person),
    person.handle ?? "",
    person.name ?? "",
    ...person.crews.map((c) => c.crewName),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function visiblePeople(people: Person[], query: Query): Person[] {
  return people.filter((p) => matches(p, query.q));
}
