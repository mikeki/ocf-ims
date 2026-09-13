// SPDX-License-Identifier: Apache-2.0

import type { Row } from "@/features/dispatch/query";

/** The open incident's neighbours in the table's current order (plan 09x). */
export function neighboursOf(
  visible: Row[],
  number: number,
): { prev?: number; next?: number } {
  const index = visible.findIndex((row) => row.incident.number === number);
  if (index === -1) {
    return {};
  }
  return {
    prev: visible[index - 1]?.incident.number,
    next: visible[index + 1]?.incident.number,
  };
}
