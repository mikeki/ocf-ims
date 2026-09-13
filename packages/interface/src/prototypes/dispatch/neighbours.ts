// SPDX-License-Identifier: Apache-2.0

import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";

/** The open incident's neighbours in the table's current order. */
export function neighboursOf(
  visible: Incident[],
  number: number,
): { prev?: number; next?: number } {
  const index = visible.findIndex((row) => row.number === number);
  if (index === -1) {
    return {};
  }
  return {
    prev: visible[index - 1]?.number,
    next: visible[index + 1]?.number,
  };
}
