// SPDX-License-Identifier: Apache-2.0

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ReportView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { personLabel } from "@/lib/format";

// The report table's query (docs/plans/09z-reports-design.md § The table), a
// retyped copy of src/features/dispatch/query.ts: `link` replaces `state`
// (Unlinked · Linked · All in place of Open · Closed · All — "an unlinked
// report is the one that needs dispatch", so Unlinked is the default the
// same way Open is), and there are no priority / type / area / people
// filters. Search covers summary, created-by and the entries' text,
// including templ's `/regex/` form; a bare number jumps to R-n. The URL
// carries `q`, `link`, `sort`, `dir`, `sel`, `open` exactly as 09x's does.

export type LinkFilter = "unlinked" | "linked" | "all";
export type SortKey =
  | "number"
  | "incident"
  | "summary"
  | "created"
  | "createdBy";
export type SortDir = "asc" | "desc";

export interface Query {
  link: LinkFilter;
  q: string;
  sort: { key: SortKey; dir: SortDir };
  sel?: number;
  open?: number;
}

export type Params = Record<string, string | undefined>;

export const DEFAULT_SORT = { key: "number", dir: "desc" } as const;

const SORT_KEYS: SortKey[] = [
  "number",
  "incident",
  "summary",
  "created",
  "createdBy",
];

/** The direction a column sorts in when first clicked. */
export function defaultDir(key: SortKey): SortDir {
  switch (key) {
    case "number":
    case "incident":
    case "created":
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

export function parseQuery(params: Params): Query {
  const link = params.link;
  const [sortKey, sortDir] = (params.sort ?? "").split(":");
  const key = SORT_KEYS.find((k) => k === sortKey);
  return {
    link:
      link === "linked" || link === "all" || link === "unlinked"
        ? link
        : "unlinked",
    q: params.q ?? "",
    sort: key ? { key, dir: sortDir === "asc" ? "asc" : "desc" } : DEFAULT_SORT,
    sel: int(params.sel),
    open: int(params.open),
  };
}

/** Absent means default, so a default view is a bare URL. */
export function serializeQuery(query: Query): Params {
  const sort =
    query.sort.key === DEFAULT_SORT.key && query.sort.dir === DEFAULT_SORT.dir
      ? undefined
      : `${query.sort.key}:${query.sort.dir}`;
  return {
    link: query.link === "unlinked" ? undefined : query.link,
    q: query.q || undefined,
    sort,
    sel: query.sel === undefined ? undefined : String(query.sel),
    open: query.open === undefined ? undefined : String(query.open),
  };
}

/** True when any filter is off its default — the bar shows a "Clear". */
export function isFiltered(query: Query): boolean {
  return query.link !== "unlinked" || query.q !== "";
}

export function clearFilters(query: Query): Query {
  return { ...query, link: "unlinked", q: "" };
}

/** A row `applyQuery` could show, before filtering — the table's `byNumber`. */
export type Row = ReportView & { report: NonNullable<ReportView["report"]> };

function hasReport(view: ReportView): view is Row {
  return view.report !== undefined;
}

export function toRows(views: ReportView[]): Row[] {
  return views.filter(hasReport);
}

/** A bare integer in the search box means "that report" (templ's rule). */
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

function ms(row: Row, field: "created"): number {
  const stamp = row.report[field];
  return stamp ? timestampDate(stamp).getTime() : 0;
}

function entriesText(row: Row): string {
  return row.report.journalEntries.map((e) => e.text).join(" ");
}

/**
 * Filter, search and sort, client-side over the whole event's reports — the
 * same shape as the incident table's `applyQuery`.
 */
export function applyQuery(views: ReportView[], query: Query): Row[] {
  const match = matcher(query.q);
  const number = bareNumber(query.q);
  const kept = toRows(views).filter((row) => {
    const report = row.report;
    const linked = report.incident !== undefined && report.incident > 0;
    if (query.link === "unlinked" && linked) {
      return false;
    }
    if (query.link === "linked" && !linked) {
      return false;
    }
    if (number !== undefined) {
      return String(report.number).startsWith(String(number));
    }
    return match(
      [
        `R-${report.number}`,
        report.summary ?? "",
        personLabel(report.createdBy),
        entriesText(row),
      ].join(" "),
    );
  });
  return sortRows(kept, query.sort);
}

function sortRows(rows: Row[], sort: Query["sort"]): Row[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const cmp = (a: Row, b: Row): number => {
    switch (sort.key) {
      case "number":
        return a.report.number - b.report.number;
      case "incident":
        return (a.report.incident ?? 0) - (b.report.incident ?? 0);
      case "summary":
        return (a.report.summary ?? "").localeCompare(b.report.summary ?? "");
      case "created":
        return ms(a, "created") - ms(b, "created");
      case "createdBy":
        return personLabel(a.report.createdBy).localeCompare(
          personLabel(b.report.createdBy),
        );
    }
  };
  // Ties fall back to the number so the order is stable across pokes.
  return [...rows].sort(
    (a, b) => dir * cmp(a, b) || (b.report.number - a.report.number) * dir,
  );
}
