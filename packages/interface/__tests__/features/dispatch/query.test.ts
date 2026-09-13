// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  applyQuery,
  bareNumber,
  DEFAULT_SORT,
  defaultDir,
  isFiltered,
  type Lookups,
  parseQuery,
  peopleOptions,
  serializeQuery,
} from "@/features/dispatch/query";
import {
  makeArea,
  makeIncident,
  makeIncidentType,
  makeIncidentView,
  makeJournalEntry,
} from "@/test/fixtures";

// The dispatch query codec and `applyQuery` (plan 09x criterion 16).

const ME = 42;
const OTHER = 3;
const me = create(PersonRefSchema, { personId: ME, handle: "Dee" });
const other = create(PersonRefSchema, { personId: OTHER, handle: "Marisol" });

const lookups: Lookups = {
  types: [
    makeIncidentType({ id: 1, name: "Medical" }),
    makeIncidentType({ id: 2, name: "Fire" }),
  ],
  areas: [makeArea({ slug: "center-camp", name: "Center Camp" })],
};

describe("parseQuery / serializeQuery", () => {
  it("round-trips a fully populated query", () => {
    const query = parseQuery({
      state: "closed",
      priority: "high,low",
      type: "1,2",
      area: "center-camp,gate",
      person: "7",
      mine: "1",
      days: "2",
      q: "fire",
      sort: "summary:asc",
      sel: "214",
      open: "214",
    });
    expect(query).toEqual({
      state: "closed",
      priority: ["high", "low"],
      type: [1, 2],
      area: ["center-camp", "gate"],
      person: 7,
      mine: true,
      days: 2,
      q: "fire",
      sort: { key: "summary", dir: "asc" },
      sel: 214,
      open: 214,
    });
    expect(serializeQuery(query)).toEqual({
      state: "closed",
      priority: "high,low",
      type: "1,2",
      area: "center-camp,gate",
      person: "7",
      mine: "1",
      days: "2",
      q: "fire",
      sort: "summary:asc",
      sel: "214",
      open: "214",
    });
  });

  it("treats absent keys as the default, and a default view serializes to a bare URL", () => {
    const query = parseQuery({});
    expect(query.state).toBe("open");
    expect(query.priority).toEqual([]);
    expect(query.mine).toBe(false);
    expect(query.sort).toEqual(DEFAULT_SORT);
    expect(serializeQuery(query)).toEqual({
      state: undefined,
      priority: undefined,
      type: undefined,
      area: undefined,
      person: undefined,
      mine: undefined,
      days: undefined,
      q: undefined,
      sort: undefined,
      sel: undefined,
      open: undefined,
    });
  });

  it("drops garbage rather than throwing", () => {
    const query = parseQuery({
      state: "sideways",
      priority: "high,loud,low",
      type: "abc,2,-3",
      person: "not-a-number",
      sort: "nonsense:asc",
      sel: "0",
    });
    expect(query.state).toBe("open");
    expect(query.priority).toEqual(["high", "low"]);
    expect(query.type).toEqual([2]);
    expect(query.person).toBeUndefined();
    expect(query.sort).toEqual(DEFAULT_SORT);
    expect(query.sel).toBeUndefined();
  });

  it("uses the fallback state only when the URL carries none", () => {
    expect(parseQuery({}, "closed").state).toBe("closed");
    expect(parseQuery({ state: "open" }, "closed").state).toBe("open");
    expect(parseQuery({ state: "garbage" }, "closed").state).toBe("closed");
  });

  it("never reads or writes `full`: the query type has no such key", () => {
    // A `full` key does not survive parseQuery — the type below has no `full`
    // field to receive it, so an unexpected extra key on the input is simply
    // ignored, and nothing this test builds can echo it back out.
    const query = parseQuery({ full: "1" } as Record<string, string>);
    expect(serializeQuery(query)).not.toHaveProperty("full");
    expect(Object.keys(query)).not.toContain("full");
  });
});

describe("isFiltered", () => {
  it("is false only for the bare default", () => {
    expect(isFiltered(parseQuery({}))).toBe(false);
    expect(isFiltered(parseQuery({ state: "closed" }))).toBe(true);
    expect(isFiltered(parseQuery({ q: "x" }))).toBe(true);
  });
});

function view(overrides: Parameters<typeof makeIncident>[0]) {
  return makeIncidentView({ incident: makeIncident(overrides) });
}

describe("applyQuery", () => {
  it("filters by state alone", () => {
    const rows = [
      view({ number: 1, state: IncidentState.OPEN }),
      view({ number: 2, state: IncidentState.CLOSED }),
    ];
    expect(
      applyQuery(rows, parseQuery({ state: "open" }), lookups, ME).map(
        (r) => r.incident.number,
      ),
    ).toEqual([1]);
    expect(
      applyQuery(rows, parseQuery({ state: "closed" }), lookups, ME).map(
        (r) => r.incident.number,
      ),
    ).toEqual([2]);
    expect(
      applyQuery(rows, parseQuery({ state: "all" }), lookups, ME)
        .map((r) => r.incident.number)
        .sort(),
    ).toEqual([1, 2]);
  });

  it("filters by priority alone", () => {
    const rows = [
      view({ number: 1, priority: IncidentPriority.HIGH }),
      view({ number: 2, priority: IncidentPriority.LOW }),
    ];
    expect(
      applyQuery(
        rows,
        parseQuery({ state: "all", priority: "high" }),
        lookups,
        ME,
      ).map((r) => r.incident.number),
    ).toEqual([1]);
  });

  it("filters by type alone", () => {
    const rows = [
      view({ number: 1, incidentTypeIds: [1] }),
      view({ number: 2, incidentTypeIds: [2] }),
    ];
    expect(
      applyQuery(
        rows,
        parseQuery({ state: "all", type: "2" }),
        lookups,
        ME,
      ).map((r) => r.incident.number),
    ).toEqual([2]);
  });

  it("filters by area alone", () => {
    const rows = [
      view({ number: 1, location: { areaSlug: "center-camp" } }),
      view({ number: 2, location: { areaSlug: "gate" } }),
    ];
    expect(
      applyQuery(
        rows,
        parseQuery({ state: "all", area: "center-camp" }),
        lookups,
        ME,
      ).map((r) => r.incident.number),
    ).toEqual([1]);
  });

  it("filters by person alone", () => {
    const rows = [
      view({ number: 1, people: [{ person: me }] }),
      view({ number: 2, people: [{ person: other }] }),
    ];
    expect(
      applyQuery(
        rows,
        parseQuery({ state: "all", person: String(ME) }),
        lookups,
        0,
      ).map((r) => r.incident.number),
    ).toEqual([1]);
  });

  it("unions every filter", () => {
    const rows = [
      view({
        number: 1,
        state: IncidentState.OPEN,
        priority: IncidentPriority.HIGH,
        incidentTypeIds: [1],
      }),
      view({
        number: 2,
        state: IncidentState.OPEN,
        priority: IncidentPriority.LOW,
        incidentTypeIds: [1],
      }),
      view({
        number: 3,
        state: IncidentState.CLOSED,
        priority: IncidentPriority.HIGH,
        incidentTypeIds: [1],
      }),
    ];
    expect(
      applyQuery(
        rows,
        parseQuery({ state: "open", priority: "high", type: "1" }),
        lookups,
        ME,
      ).map((r) => r.incident.number),
    ).toEqual([1]);
  });

  it("mine follows the Board's four rules via whyMineIncident", () => {
    const created = view({ number: 1, createdBy: me });
    const attached = view({
      number: 2,
      createdBy: other,
      people: [{ person: me }],
    });
    const mentioned = view({
      number: 3,
      createdBy: other,
      journalEntries: [makeJournalEntry({ text: "@Dee?", mentions: [me] })],
    });
    const owed = view({
      number: 4,
      createdBy: other,
      people: [{ person: me, reportRequested: timestampFromDate(new Date()) }],
    });
    const nobodys = view({ number: 5, createdBy: other });
    const rows = [created, attached, mentioned, owed, nobodys];
    const mine = applyQuery(
      rows,
      parseQuery({ state: "all", mine: "1" }),
      lookups,
      ME,
    ).map((r) => r.incident.number);
    expect(mine.sort()).toEqual([1, 2, 3, 4]);
  });

  it("filters by days since started", () => {
    const now = Date.now();
    const rows = [
      view({
        number: 1,
        started: timestampFromDate(new Date(now - 3_600_000)),
      }),
      view({
        number: 2,
        started: timestampFromDate(new Date(now - 10 * 86_400_000)),
      }),
    ];
    expect(
      applyQuery(
        rows,
        parseQuery({ state: "all", days: "1" }),
        lookups,
        ME,
        now,
      ).map((r) => r.incident.number),
    ).toEqual([1]);
  });

  it("a bare number in the search matches by prefix, bypassing text search", () => {
    const rows = [
      view({ number: 21, summary: "unrelated" }),
      view({ number: 214, summary: "unrelated" }),
      view({ number: 3, summary: "21 mentioned in text" }),
    ];
    // Default sort is number:desc, so 214 sorts before 21.
    expect(
      applyQuery(rows, parseQuery({ state: "all", q: "21" }), lookups, ME).map(
        (r) => r.incident.number,
      ),
    ).toEqual([214, 21]);
  });

  it("/re/ searches as a regex; a half-typed one matches nothing", () => {
    const rows = [
      view({ number: 1, summary: "Lost child near stage" }),
      view({ number: 2, summary: "Generator fumes" }),
    ];
    expect(
      applyQuery(
        rows,
        parseQuery({ state: "all", q: "/child|fumes/" }),
        lookups,
        ME,
      )
        .map((r) => r.incident.number)
        .sort(),
    ).toEqual([1, 2]);
    expect(
      applyQuery(
        rows,
        parseQuery({ state: "all", q: "/(unterminated/" }),
        lookups,
        ME,
      ),
    ).toEqual([]);
  });

  it("bareNumber recognizes only a plain integer", () => {
    expect(bareNumber("214")).toBe(214);
    expect(bareNumber(" 214 ")).toBe(214);
    expect(bareNumber("214x")).toBeUndefined();
    expect(bareNumber("/214/")).toBeUndefined();
  });
});

describe("defaultDir", () => {
  it("is desc for number, priority, started, modified; asc otherwise", () => {
    expect(defaultDir("number")).toBe("desc");
    expect(defaultDir("priority")).toBe("desc");
    expect(defaultDir("started")).toBe("desc");
    expect(defaultDir("modified")).toBe("desc");
    expect(defaultDir("state")).toBe("asc");
    expect(defaultDir("types")).toBe("asc");
    expect(defaultDir("area")).toBe("asc");
    expect(defaultDir("summary")).toBe("asc");
    expect(defaultDir("people")).toBe("asc");
  });
});

describe("applyQuery sort", () => {
  const rows = [
    view({
      number: 1,
      summary: "Bravo",
      priority: IncidentPriority.LOW,
      state: IncidentState.OPEN,
    }),
    view({
      number: 2,
      summary: "Alpha",
      priority: IncidentPriority.HIGH,
      state: IncidentState.CLOSED,
    }),
  ];

  it("sorts by each key", () => {
    const byNumberDesc = applyQuery(
      rows,
      parseQuery({ state: "all", sort: "number:desc" }),
      lookups,
      ME,
    ).map((r) => r.incident.number);
    expect(byNumberDesc).toEqual([2, 1]);

    const bySummaryAsc = applyQuery(
      rows,
      parseQuery({ state: "all", sort: "summary:asc" }),
      lookups,
      ME,
    ).map((r) => r.incident.number);
    expect(bySummaryAsc).toEqual([2, 1]); // Alpha before Bravo

    const byPriorityDesc = applyQuery(
      rows,
      parseQuery({ state: "all", sort: "priority:desc" }),
      lookups,
      ME,
    ).map((r) => r.incident.number);
    expect(byPriorityDesc[0]).toBe(2); // HIGH first
  });

  it("breaks ties by number, descending, regardless of the primary direction", () => {
    const tied = [
      view({ number: 5, priority: IncidentPriority.NORMAL }),
      view({ number: 9, priority: IncidentPriority.NORMAL }),
      view({ number: 1, priority: IncidentPriority.NORMAL }),
    ];
    const asc = applyQuery(
      tied,
      parseQuery({ state: "all", sort: "priority:asc" }),
      lookups,
      ME,
    ).map((r) => r.incident.number);
    expect(asc).toEqual([9, 5, 1]);
  });
});

describe("peopleOptions", () => {
  it("collects the people on any loaded row, sorted by label", () => {
    const rows = [
      view({ number: 1, people: [{ person: other }] }),
      view({ number: 2, people: [{ person: me }] }),
    ];
    expect(peopleOptions(rows)).toEqual([
      { key: String(ME), label: "Dee" },
      { key: String(OTHER), label: "Marisol" },
    ]);
  });
});
