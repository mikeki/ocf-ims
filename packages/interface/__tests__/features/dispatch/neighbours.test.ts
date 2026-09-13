// SPDX-License-Identifier: Apache-2.0

import { neighboursOf } from "@/features/dispatch/neighbours";
import type { Row } from "@/features/dispatch/query";
import { makeIncident, makeIncidentView } from "@/test/fixtures";

// `.incident` is always set here (makeIncident never returns undefined), so
// this is a safe narrowing, not a lie about `applyQuery`'s own filtering.
function row(number: number): Row {
  return makeIncidentView({ incident: makeIncident({ number }) }) as Row;
}

describe("neighboursOf", () => {
  const rows = [row(3), row(2), row(1)]; // the table's current (sorted) order

  it("has no prev at the first row", () => {
    expect(neighboursOf(rows, 3)).toEqual({ prev: undefined, next: 2 });
  });

  it("has no next at the last row", () => {
    expect(neighboursOf(rows, 1)).toEqual({ prev: 2, next: undefined });
  });

  it("has both neighbours in the middle", () => {
    expect(neighboursOf(rows, 2)).toEqual({ prev: 3, next: 1 });
  });

  it("answers neither when the number is not visible", () => {
    expect(neighboursOf(rows, 999)).toEqual({});
  });

  it("answers neither on an empty table", () => {
    expect(neighboursOf([], 1)).toEqual({});
  });
});
