// SPDX-License-Identifier: Apache-2.0

import { columnsFor } from "@/features/dispatch/columns";

// `columnsFor` at the round's three reference widths (plan 09x criterion 16).
// These are the TABLE's own measured width — with the top-bar shell (the
// pick) that is the window width, since the bar spends no horizontal space.
// Number, state, priority and the summary never hide at any of the three.

const ALL_KEYS = [
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

describe("columnsFor", () => {
  it("shows every column at 1440 and at 1280", () => {
    expect(columnsFor(1440).map((c) => c.key)).toEqual(ALL_KEYS);
    expect(columnsFor(1280).map((c) => c.key)).toEqual(ALL_KEYS);
  });

  it("hides only 'people' (first in the hide order) at 1024", () => {
    expect(columnsFor(1024).map((c) => c.key)).toEqual(
      ALL_KEYS.filter((k) => k !== "people"),
    );
  });

  it("never hides number, state, priority or the summary, however narrow", () => {
    for (const width of [1024, 700, 400]) {
      const keys = columnsFor(width).map((c) => c.key);
      expect(keys).toEqual(
        expect.arrayContaining(["number", "state", "priority", "summary"]),
      );
    }
  });
});
