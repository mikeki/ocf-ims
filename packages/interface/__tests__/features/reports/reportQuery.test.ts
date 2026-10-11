// SPDX-License-Identifier: Apache-2.0

import {
  applyQuery,
  parseQuery,
  type Query,
  serializeQuery,
} from "@/features/reports/reportQuery";
import { makeJournalEntry, makeReport, makeReportView } from "@/test/fixtures";

const views = [
  makeReportView({
    report: makeReport({
      number: 12,
      summary: "Lost child near the stage",
      createdBy: { personId: 1, handle: "Dee" },
      journalEntries: [makeJournalEntry({ id: 1, text: "Found by Ray" })],
    }),
  }),
  makeReportView({
    report: makeReport({
      number: 120,
      summary: "Water leak",
      incident: 5,
      createdBy: { personId: 2, handle: "Priya" },
    }),
  }),
  makeReportView({
    report: makeReport({
      number: 7,
      summary: "Gate 4 jam",
      createdBy: { personId: 2, handle: "Priya" },
    }),
  }),
];

const base: Query = {
  link: "all",
  q: "",
  sort: { key: "number", dir: "asc" },
};

function numbers(q: Partial<Query>): number[] {
  return applyQuery(views, { ...base, ...q }).map((r) => r.report.number);
}

describe("reportQuery — search", () => {
  it("matches summary, created by, and the entries' text", () => {
    expect(numbers({ q: "stage" })).toEqual([12]);
    expect(numbers({ q: "priya" })).toEqual([7, 120]);
    expect(numbers({ q: "found by" })).toEqual([12]);
  });

  it("searches /regex/ as a regex, and a half-typed one matches nothing", () => {
    expect(numbers({ q: "/leak|jam/" })).toEqual([7, 120]);
    expect(numbers({ q: "/(/" })).toEqual([]);
  });

  it("treats a bare number as a prefix of the report number", () => {
    expect(numbers({ q: "12" })).toEqual([12, 120]);
    expect(numbers({ q: "7" })).toEqual([7]);
  });

  it("filters by link", () => {
    expect(numbers({ link: "unlinked" })).toEqual([7, 12]);
    expect(numbers({ link: "linked" })).toEqual([120]);
  });
});

describe("reportQuery — the URL", () => {
  it("round trips every param", () => {
    const query: Query = {
      link: "linked",
      q: "/leak/",
      sort: { key: "createdBy", dir: "asc" },
      sel: 12,
      open: 12,
    };
    expect(parseQuery(serializeQuery(query))).toEqual(query);
  });

  it("serializes the default view as a bare URL", () => {
    const query = parseQuery({});
    expect(query.link).toBe("unlinked");
    expect(
      Object.values(serializeQuery(query)).every((v) => v === undefined),
    ).toBe(true);
  });

  it("ignores junk", () => {
    const query = parseQuery({
      link: "x",
      sort: "nope:up",
      sel: "-3",
      open: "a",
    });
    expect(query.link).toBe("unlinked");
    expect(query.sort).toEqual({ key: "number", dir: "desc" });
    expect(query.sel).toBeUndefined();
    expect(query.open).toBeUndefined();
  });
});
