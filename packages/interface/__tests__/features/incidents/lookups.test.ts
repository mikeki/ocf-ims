// SPDX-License-Identifier: Apache-2.0

import {
  areaName,
  sortIncidentsNewestFirst,
  typeName,
} from "@/features/incidents/lookups";
import {
  makeArea,
  makeIncident,
  makeIncidentType,
  makeIncidentView,
} from "@/test/fixtures";

describe("areaName", () => {
  it("returns undefined when there is no slug", () => {
    expect(areaName([makeArea()], undefined)).toBeUndefined();
  });

  it("returns the area's name when the slug matches", () => {
    const areas = [makeArea({ slug: "center-camp", name: "Center Camp" })];
    expect(areaName(areas, "center-camp")).toBe("Center Camp");
  });

  it("falls back to the raw slug when the areas list doesn't have it", () => {
    expect(areaName([], "center-camp")).toBe("center-camp");
    expect(areaName(undefined, "center-camp")).toBe("center-camp");
  });
});

describe("typeName", () => {
  it("returns the type's name when the id matches", () => {
    const types = [makeIncidentType({ id: 3, name: "Medical" })];
    expect(typeName(types, 3)).toBe("Medical");
  });

  it("falls back to Type #<id> when it's missing", () => {
    expect(typeName([], 5)).toBe("Type #5");
    expect(typeName(undefined, 5)).toBe("Type #5");
  });
});

describe("sortIncidentsNewestFirst", () => {
  it("sorts by number descending", () => {
    const views = [
      makeIncidentView({ incident: makeIncident({ number: 1 }) }),
      makeIncidentView({ incident: makeIncident({ number: 3 }) }),
      makeIncidentView({ incident: makeIncident({ number: 2 }) }),
    ];

    const sorted = sortIncidentsNewestFirst(views);

    expect(sorted.map((v) => v.incident?.number)).toEqual([3, 2, 1]);
  });

  it("doesn't mutate the input array", () => {
    const views = [
      makeIncidentView({ incident: makeIncident({ number: 1 }) }),
      makeIncidentView({ incident: makeIncident({ number: 2 }) }),
    ];

    sortIncidentsNewestFirst(views);

    expect(views.map((v) => v.incident?.number)).toEqual([1, 2]);
  });
});
