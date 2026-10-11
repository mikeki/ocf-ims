// SPDX-License-Identifier: Apache-2.0

import type { Row } from "@/prototypes/reports/reportQuery";

/** The open report's neighbours in the table's current order (plan 09x's pattern). */
export function neighboursOf(
  visible: Row[],
  number: number,
): { prev?: number; next?: number } {
  const index = visible.findIndex((row) => row.report.number === number);
  if (index === -1) {
    return {};
  }
  return {
    prev: visible[index - 1]?.report.number,
    next: visible[index + 1]?.report.number,
  };
}
