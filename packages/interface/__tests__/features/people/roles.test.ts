// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { AccessForEventSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import {
  mayRemove,
  orderFor,
  type RosterAccess,
  rosterAccessFrom,
  rungLabel,
  rungsFor,
  sectionsFor,
} from "@/features/people/roles";
import { makePerson } from "@/test/fixtures";

const admin: RosterAccess = {
  admin: true,
  inviteReporters: true,
  writeIncidents: true,
};
const inviter: RosterAccess = {
  admin: false,
  inviteReporters: true,
  writeIncidents: false,
};
const nobody: RosterAccess = {
  admin: false,
  inviteReporters: false,
  writeIncidents: false,
};

const W = ParticipationType.WRITER;
const L = ParticipationType.CREW_LEADER;
const R = ParticipationType.REPORTER;
const V = ParticipationType.VOLUNTEER;
const P = ParticipationType.PUBLIC;

describe("rungsFor — the ceiling per access", () => {
  it("offers an admin every rung but crew leader, on every row", () => {
    for (const type of [W, L, R, V, P]) {
      expect(rungsFor(admin, makePerson({ participationType: type }))).toEqual([
        W,
        R,
        V,
        P,
      ]);
    }
  });

  it("offers an inviter Reporter / Volunteer / Public only", () => {
    expect(rungsFor(inviter, makePerson({ participationType: R }))).toEqual([
      R,
      V,
      P,
    ]);
  });

  it("gives an inviter no menu on a writer's or a crew leader's card", () => {
    expect(rungsFor(inviter, makePerson({ participationType: W }))).toEqual([]);
    expect(rungsFor(inviter, makePerson({ participationType: L }))).toEqual([]);
    expect(mayRemove(inviter, makePerson({ participationType: W }))).toBe(
      false,
    );
  });

  it("offers a no-login person Volunteer / Public only", () => {
    const person = makePerson({ hasPassword: false, participationType: V });
    expect(rungsFor(admin, person)).toEqual([V, P]);
    expect(rungsFor(inviter, person)).toEqual([V, P]);
  });

  it("offers nothing to someone who is neither", () => {
    expect(rungsFor(nobody, makePerson())).toEqual([]);
    expect(mayRemove(nobody, makePerson())).toBe(false);
  });

  it("never offers crew leader (it is derived)", () => {
    expect(rungsFor(admin, makePerson())).not.toContain(L);
  });
});

describe("rosterAccessFrom", () => {
  it("reads admin and the event's access from GetAuthStatus", () => {
    const auth = {
      authenticated: true,
      admin: false,
      eventAccess: {
        1: create(AccessForEventSchema, {
          inviteReporters: true,
          writeIncidents: true,
        }),
      },
    };
    expect(rosterAccessFrom(auth, 1)).toEqual({
      admin: false,
      inviteReporters: true,
      writeIncidents: true,
    });
    expect(rosterAccessFrom(auth, 2).inviteReporters).toBe(false);
    expect(rosterAccessFrom(undefined, 1)).toEqual(nobody);
  });
});

describe("sectionsFor — the section order", () => {
  it("groups by rung in the fixed order, then No login, dropping empties", () => {
    const people = [
      makePerson({ personId: 1, participationType: P }),
      makePerson({ personId: 2, participationType: W }),
      makePerson({ personId: 3, hasPassword: false, participationType: R }),
      makePerson({ personId: 4, participationType: L }),
      makePerson({ personId: 5, participationType: V }),
    ];
    expect(sectionsFor(people).map((s) => s.label)).toEqual([
      "FC/BUM",
      "Crew leaders",
      "Volunteers",
      "Public",
      "No login",
    ]);
    expect(orderFor(people)).toEqual([2, 4, 5, 1, 3]);
  });

  it("labels the rungs with templ's words", () => {
    expect(rungLabel(W)).toBe("FC/BUM");
    expect(rungLabel(R)).toBe("Reporter");
  });
});
