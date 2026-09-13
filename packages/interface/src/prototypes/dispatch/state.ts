// SPDX-License-Identifier: Apache-2.0

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import { areaName, typeName } from "@/features/incidents/lookups";
import { personLabel } from "@/lib/format";

// The URL is the state (plan 09x § The URL is the state): every filter, the
// sort, the search and the selection are query keys, absent means default,
// and the whole thing round-trips so a view is a link. `open` is this
// surface's stand-in for the Page variant's path segment.

export type StateFilter = "open" | "closed" | "all";
export type PriorityKey = "high" | "normal" | "low";
export type SortKey =
  | "number"
  | "state"
  | "priority"
  | "types"
  | "area"
  | "summary"
  | "started"
  | "modified"
  | "people";
export type SortDir = "asc" | "desc";

export interface Query {
  state: StateFilter;
  priority: PriorityKey[];
  type: number[];
  area: string[];
  person?: number;
  mine: boolean;
  days?: number;
  q: string;
  sort: { key: SortKey; dir: SortDir };
  sel?: number;
  open?: number;
  /** The drawer's incident opened as a full page (the pushed route). */
  full: boolean;
}

export type Params = Record<string, string | undefined>;

export const DEFAULT_SORT = { key: "number", dir: "desc" } as const;

const SORT_KEYS: SortKey[] = [
  "number",
  "state",
  "priority",
  "types",
  "area",
  "summary",
  "started",
  "modified",
  "people",
];

/** The direction a column sorts in when first clicked. */
export function defaultDir(key: SortKey): SortDir {
  switch (key) {
    case "number":
    case "priority":
    case "started":
    case "modified":
      return "desc";
    default:
      return "asc";
  }
}

function int(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function list(value: string | undefined): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

export function parseQuery(params: Params): Query {
  const state = params.state;
  const [sortKey, sortDir] = (params.sort ?? "").split(":");
  const key = SORT_KEYS.find((k) => k === sortKey);
  return {
    state: state === "closed" || state === "all" ? state : "open",
    priority: list(params.priority).filter(
      (p): p is PriorityKey => p === "high" || p === "normal" || p === "low",
    ),
    type: list(params.type)
      .map((t) => int(t))
      .filter((t): t is number => t !== undefined),
    area: list(params.area),
    person: int(params.person),
    mine: params.mine === "1",
    days: int(params.days),
    q: params.q ?? "",
    sort: key ? { key, dir: sortDir === "asc" ? "asc" : "desc" } : DEFAULT_SORT,
    sel: int(params.sel),
    open: int(params.open),
    full: params.full === "1",
  };
}

/** Absent means default, so a default view is a bare URL. */
export function serializeQuery(query: Query): Params {
  const sort =
    query.sort.key === DEFAULT_SORT.key && query.sort.dir === DEFAULT_SORT.dir
      ? undefined
      : `${query.sort.key}:${query.sort.dir}`;
  return {
    state: query.state === "open" ? undefined : query.state,
    priority: query.priority.length ? query.priority.join(",") : undefined,
    type: query.type.length ? query.type.join(",") : undefined,
    area: query.area.length ? query.area.join(",") : undefined,
    person: query.person === undefined ? undefined : String(query.person),
    mine: query.mine ? "1" : undefined,
    days: query.days === undefined ? undefined : String(query.days),
    q: query.q || undefined,
    sort,
    sel: query.sel === undefined ? undefined : String(query.sel),
    open: query.open === undefined ? undefined : String(query.open),
    full: query.full ? "1" : undefined,
  };
}

/** True when any filter is off its default — the bar shows a "Clear". */
export function isFiltered(query: Query): boolean {
  return (
    query.state !== "open" ||
    query.priority.length > 0 ||
    query.type.length > 0 ||
    query.area.length > 0 ||
    query.person !== undefined ||
    query.mine ||
    query.days !== undefined ||
    query.q !== ""
  );
}

export function clearFilters(query: Query): Query {
  return {
    ...query,
    state: "open",
    priority: [],
    type: [],
    area: [],
    person: undefined,
    mine: false,
    days: undefined,
    q: "",
  };
}

export interface Lookups {
  types: IncidentType[];
  areas: Area[];
}

export function priorityKey(priority: IncidentPriority): PriorityKey {
  switch (priority) {
    case IncidentPriority.HIGH:
      return "high";
    case IncidentPriority.LOW:
      return "low";
    default:
      return "normal";
  }
}

export function typesText(incident: Incident, lookups: Lookups): string {
  return incident.incidentTypeIds
    .map((id) => typeName(lookups.types, id))
    .join(", ");
}

export function areaText(incident: Incident, lookups: Lookups): string {
  return areaName(lookups.areas, incident.location?.areaSlug) ?? "";
}

export function peopleText(incident: Incident): string {
  return incident.people.map((p) => personLabel(p.person)).join(", ");
}

function ms(incident: Incident, field: "started" | "lastModified"): number {
  const stamp = incident[field];
  return stamp ? timestampDate(stamp).getTime() : 0;
}

/** A bare integer in the search box means "that number" (templ's rule). */
export function bareNumber(q: string): number | undefined {
  return /^\d+$/.test(q.trim()) ? Number.parseInt(q, 10) : undefined;
}

/** `/re/` searches as a regex (templ's syntax); anything else as text. */
function matcher(q: string): (haystack: string) => boolean {
  const trimmed = q.trim();
  if (!trimmed) {
    return () => true;
  }
  const re = /^\/(.+)\/$/.exec(trimmed);
  if (re?.[1]) {
    try {
      const regex = new RegExp(re[1], "i");
      return (h) => regex.test(h);
    } catch {
      // A half-typed regex matches nothing rather than throwing on every row.
      return () => false;
    }
  }
  const needle = trimmed.toLowerCase();
  return (h) => h.toLowerCase().includes(needle);
}

/** Filter, search and sort, client-side over the whole event (09x). */
export function applyQuery(
  rows: Incident[],
  query: Query,
  lookups: Lookups,
  me: number,
  now = Date.now(),
): Incident[] {
  const match = matcher(query.q);
  const number = bareNumber(query.q);
  const since =
    query.days === undefined ? undefined : now - query.days * 86_400_000;
  const kept = rows.filter((row) => {
    if (query.state === "open" && row.state !== IncidentState.OPEN) {
      return false;
    }
    if (query.state === "closed" && row.state !== IncidentState.CLOSED) {
      return false;
    }
    if (
      query.priority.length &&
      !query.priority.includes(priorityKey(row.priority))
    ) {
      return false;
    }
    if (
      query.type.length &&
      !row.incidentTypeIds.some((id) => query.type.includes(id))
    ) {
      return false;
    }
    if (
      query.area.length &&
      !query.area.includes(row.location?.areaSlug ?? "")
    ) {
      return false;
    }
    if (
      query.person !== undefined &&
      !row.people.some((p) => p.person?.personId === query.person)
    ) {
      return false;
    }
    if (
      query.mine &&
      row.createdBy?.personId !== me &&
      !row.people.some((p) => p.person?.personId === me)
    ) {
      return false;
    }
    if (since !== undefined && ms(row, "started") < since) {
      return false;
    }
    if (number !== undefined) {
      return String(row.number).startsWith(String(number));
    }
    return match(
      [
        `#${row.number}`,
        row.summary ?? "",
        typesText(row, lookups),
        areaText(row, lookups),
        peopleText(row),
      ].join(" "),
    );
  });
  return sortRows(kept, query.sort, lookups);
}

function sortRows(
  rows: Incident[],
  sort: Query["sort"],
  lookups: Lookups,
): Incident[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const cmp = (a: Incident, b: Incident): number => {
    switch (sort.key) {
      case "number":
        return a.number - b.number;
      case "state":
        return a.state - b.state;
      case "priority":
        return a.priority - b.priority;
      case "types":
        return typesText(a, lookups).localeCompare(typesText(b, lookups));
      case "area":
        return areaText(a, lookups).localeCompare(areaText(b, lookups));
      case "summary":
        return (a.summary ?? "").localeCompare(b.summary ?? "");
      case "started":
        return ms(a, "started") - ms(b, "started");
      case "modified":
        return ms(a, "lastModified") - ms(b, "lastModified");
      case "people":
        return peopleText(a).localeCompare(peopleText(b));
    }
  };
  // Ties fall back to the number so the order is stable across pokes.
  return [...rows].sort(
    (a, b) => dir * cmp(a, b) || (b.number - a.number) * dir,
  );
}
