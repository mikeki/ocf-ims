// SPDX-License-Identifier: Apache-2.0

import { dispatch, ledgerColumn, spacing } from "@/design/tokens";
import type { SortKey } from "@/features/dispatch/query";

// The table's columns (plan 09x criterion 3), promoted from
// src/prototypes/dispatch/columns.ts: every column but the summary has a
// fixed width, from the `dispatch` token block; the summary is the one that
// yields — down to `dispatch.summaryMin`, after which columns hide in
// `HIDE_ORDER` (people first, then started, types, area, last modified)
// until it fits. Number, state, priority and the summary never hide.

export interface Column {
  key: SortKey;
  label: string;
  /** Fixed width in px; absent = flexible (the summary). */
  width?: number;
  align?: "left" | "right";
}

export const COLUMNS: readonly Column[] = [
  { key: "number", label: "#", width: ledgerColumn, align: "right" },
  { key: "state", label: "State", width: dispatch.state },
  { key: "priority", label: "Priority", width: dispatch.priority },
  { key: "types", label: "Type", width: dispatch.types },
  { key: "area", label: "Area", width: dispatch.area },
  { key: "summary", label: "Summary" },
  { key: "started", label: "Started", width: dispatch.started, align: "right" },
  {
    key: "modified",
    label: "Changed",
    width: dispatch.modified,
    align: "right",
  },
  { key: "people", label: "People", width: dispatch.people },
];

/** First to go is first in the list. */
const HIDE_ORDER: SortKey[] = [
  "people",
  "started",
  "types",
  "area",
  "modified",
];

/** The row's horizontal padding plus the gap between cells — `IncidentRow`'s. */
const ROW_PADDING = 2 * spacing.lg;
const CELL_GAP = spacing.md;

function summaryWidth(columns: Column[], tableWidth: number): number {
  const fixed = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  return tableWidth - ROW_PADDING - fixed - CELL_GAP * (columns.length - 1);
}

/**
 * The columns a table of this width shows, in order. `tableWidth` is the
 * TABLE's own measured width (its `onLayout`), not the window's — with the
 * top bar shell the two are the same, since the bar spends no horizontal
 * space; a sidebar shell would have to subtract its own width first.
 */
export function columnsFor(tableWidth: number): Column[] {
  let columns = [...COLUMNS];
  for (const key of HIDE_ORDER) {
    if (summaryWidth(columns, tableWidth) >= dispatch.summaryMin) {
      break;
    }
    columns = columns.filter((c) => c.key !== key);
  }
  return columns;
}
