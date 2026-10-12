// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { PersonCrewSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  matches,
  parseQuery,
  serializeQuery,
  visiblePeople,
} from "@/features/people/peopleQuery";
import { makePerson } from "@/test/fixtures";

describe("parseQuery / serializeQuery", () => {
  it("round-trips q, sel and open", () => {
    const query = parseQuery({ q: "ash", sel: "7", open: "7" });
    expect(query).toEqual({ q: "ash", sel: 7, open: 7 });
    expect(serializeQuery(query)).toEqual({ q: "ash", sel: "7", open: "7" });
  });

  it("makes a default view a bare URL", () => {
    expect(serializeQuery(parseQuery({}))).toEqual({
      q: undefined,
      sel: undefined,
      open: undefined,
    });
  });

  it("drops a non-numeric or non-positive id", () => {
    expect(parseQuery({ sel: "x", open: "0" })).toEqual({
      q: "",
      sel: undefined,
      open: undefined,
    });
  });
});

describe("matches / visiblePeople", () => {
  const person = makePerson({
    personId: 3,
    handle: "ash",
    name: "Ash Delacroix",
    crews: [
      create(PersonCrewSchema, {
        crewName: "Sanctuary",
        crewSlug: "sanctuary",
        isLeader: false,
      }),
    ],
  });

  it("matches the handle, the name and a crew name, any case", () => {
    expect(matches(person, "ASH")).toBe(true);
    expect(matches(person, "delacroix")).toBe(true);
    expect(matches(person, "sanct")).toBe(true);
    expect(matches(person, "nobody")).toBe(false);
  });

  it("matches everything for an empty search", () => {
    expect(matches(person, "  ")).toBe(true);
  });

  it("filters the list", () => {
    const other = makePerson({ personId: 4, handle: "bo", name: "Bo Lee" });
    expect(
      visiblePeople([person, other], { q: "lee" }).map((p) => p.personId),
    ).toEqual([4]);
  });
});
