// SPDX-License-Identifier: Apache-2.0

import { spacing } from "@/design/tokens";
import type { SortKey } from "@/prototypes/reports/reportQuery";

// The report table's columns (docs/plans/09z-reports-design.md § The table),
// a retyped copy of src/features/dispatch/columns.ts: Report# and IMS# are
// fixed ledger-style figure columns, Created and Created by are fixed,
// Summary is the one that yields. There is no hide order — five columns at
// the drawer's ~676px already fit without dropping any (unlike the incident
// table's nine) — so `columnsFor` only ever shrinks the summary.
//
// These widths are prototype-local, not promoted tokens (src/design/ is out
// of bounds for this round): they echo the shape of `dispatch` in
// src/design/tokens.ts without adding to it.

export interface Column {
  key: SortKey;
  label: string;
  /** Fixed width in px; absent = flexible (the summary). */
  width?: number;
  align?: "left" | "right";
}

const width = {
  number: 64,
  incidentNumber: 64,
  created: 84,
  createdBy: 140,
  summaryMin: 200,
} as const;

export const COLUMNS: readonly Column[] = [
  { key: "number", label: "Report#", width: width.number, align: "right" },
  {
    key: "incident",
    label: "IMS#",
    width: width.incidentNumber,
    align: "right",
  },
  { key: "summary", label: "Summary" },
  { key: "created", label: "Created", width: width.created, align: "right" },
  { key: "createdBy", label: "Created by", width: width.createdBy },
];

/** The row's horizontal padding plus the gap between cells — `ReportRow`'s. */
export const ROW_PADDING = 2 * spacing.lg;
export const CELL_GAP = spacing.md;

/**
 * Every column, always: the report table only ever renders at the drawer's
 * or the page's width (the phone keeps the Board, § The table), both wide
 * enough for every fixed column plus `width.summaryMin` — unlike the
 * incident table, this has no hide order to earn. `columnsFor` keeps the
 * incident table's signature shape (a width in) so a caller measuring its
 * own container, not the window, still has somewhere to pass it.
 */
export function columnsFor(_tableWidth: number): Column[] {
  return [...COLUMNS];
}
