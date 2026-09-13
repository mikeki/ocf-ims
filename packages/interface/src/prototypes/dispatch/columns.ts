// SPDX-License-Identifier: Apache-2.0

import { ledgerColumn, spacing } from "@/design/tokens";
import type { SortKey } from "@/prototypes/dispatch/state";

// The table's columns (plan 09x § Decisions the round must also take). Every
// column but the summary has a fixed width; the summary is the one that
// yields — down to `SUMMARY_MIN`, after which columns hide in `HIDE_ORDER`
// (people first, then started, types, area, last modified) until it fits.
// Number, state, priority and the summary never hide. On promotion the
// widths become tokens; here they are the thing under judgement.

export interface Column {
  key: SortKey;
  label: string;
  /** Fixed width in px; absent = flexible (the summary). */
  width?: number;
  align?: "left" | "right";
}

export const COLUMNS: readonly Column[] = [
  { key: "number", label: "#", width: ledgerColumn, align: "right" },
  { key: "state", label: "State", width: 128 },
  { key: "priority", label: "Priority", width: 68 },
  { key: "types", label: "Type", width: 150 },
  { key: "area", label: "Area", width: 130 },
  { key: "summary", label: "Summary" },
  { key: "started", label: "Started", width: 72, align: "right" },
  { key: "modified", label: "Changed", width: 72, align: "right" },
  { key: "people", label: "People", width: 150 },
];

/** First to go is first in the list. */
const HIDE_ORDER: SortKey[] = [
  "people",
  "started",
  "types",
  "area",
  "modified",
];

/** The summary never gets less than this before a column hides. */
const SUMMARY_MIN = 200;

/** The row's horizontal padding plus the gap between cells — `IncidentRow`'s. */
const ROW_PADDING = 2 * spacing.lg;
const CELL_GAP = spacing.md;

function summaryWidth(columns: Column[], tableWidth: number): number {
  const fixed = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  return tableWidth - ROW_PADDING - fixed - CELL_GAP * (columns.length - 1);
}

/** The columns a table of this width shows, in order. */
export function columnsFor(tableWidth: number): Column[] {
  let columns = [...COLUMNS];
  for (const key of HIDE_ORDER) {
    if (summaryWidth(columns, tableWidth) >= SUMMARY_MIN) {
      break;
    }
    columns = columns.filter((c) => c.key !== key);
  }
  return columns;
}
