// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { eventAccess, isAdmin } from "@/lib/permissions";

// The rung labels and the roster's grouping (docs/plans/09aa-roster-design.md
// § The table): templ's words — FC/BUM for a writer, Reporter, Volunteer,
// Public; crew leader is derived, never hand-assigned (10c), and carries its
// own label. Not_present / ejected are Remove's two forms, not a menu rung.

const LABELS: Record<ParticipationType, string> = {
  [ParticipationType.UNSPECIFIED]: "—",
  [ParticipationType.WRITER]: "FC/BUM",
  [ParticipationType.CREW_LEADER]: "Crew leader",
  [ParticipationType.REPORTER]: "Reporter",
  [ParticipationType.VOLUNTEER]: "Volunteer",
  [ParticipationType.PUBLIC]: "Public",
  [ParticipationType.NOT_PRESENT]: "Not present",
  [ParticipationType.EJECTED]: "Ejected",
};

export function rungLabel(type: ParticipationType): string {
  return LABELS[type] ?? "—";
}

export interface Section {
  key: string;
  label: string;
  people: Person[];
}

const RUNG_SECTIONS: { key: string; label: string; type: ParticipationType }[] =
  [
    { key: "writer", label: "FC/BUM", type: ParticipationType.WRITER },
    {
      key: "crewLeader",
      label: "Crew leaders",
      type: ParticipationType.CREW_LEADER,
    },
    { key: "reporter", label: "Reporters", type: ParticipationType.REPORTER },
    {
      key: "volunteer",
      label: "Volunteers",
      type: ParticipationType.VOLUNTEER,
    },
    { key: "public", label: "Public", type: ParticipationType.PUBLIC },
  ];

/**
 * Groups the roster by standing (§ The table): a section per rung for
 * everyone who can sign in, in the fixed order above, then one more block —
 * "No login" — for a name-only person (`has_password` false) whatever their
 * rung. Empty sections are dropped, search included, so a filtered view
 * never shows a bare header.
 */
export function sectionsFor(people: Person[]): Section[] {
  const loggedIn = people.filter((p) => p.hasPassword);
  const noLogin = people.filter((p) => !p.hasPassword);
  const sections: Section[] = RUNG_SECTIONS.map(({ key, label, type }) => ({
    key,
    label,
    people: loggedIn.filter((p) => p.participationType === type),
  })).filter((s) => s.people.length > 0);
  if (noLogin.length > 0) {
    sections.push({ key: "noLogin", label: "No login", people: noLogin });
  }
  return sections;
}

/** The person rows in display order, headers excluded — what `j`/`k` walk. */
export function orderFor(people: Person[]): number[] {
  return sectionsFor(people).flatMap((s) => s.people.map((p) => p.personId));
}

/**
 * What the viewer may do on the roster (docs/plans/09aa-roster-design.md
 * § Gating and the ceiling), derived once per screen from GetAuthStatus:
 * `isAdmin(auth)` and the event's `inviteReporters` / `writeIncidents`.
 * All-false until GetAuthStatus has answered.
 */
export interface RosterAccess {
  admin: boolean;
  inviteReporters: boolean;
  writeIncidents: boolean;
}

export function rosterAccessFrom(
  auth: Parameters<typeof isAdmin>[0] & Parameters<typeof eventAccess>[0],
  eventId: number,
): RosterAccess {
  const admin = isAdmin(auth);
  const access = eventAccess(auth, eventId);
  return {
    admin,
    inviteReporters: access.inviteReporters,
    writeIncidents: access.writeIncidents,
  };
}

/** The viewer's roster access for one event; the same GetAuthStatus query `useEventAccess` shares. */
export function useRosterAccess(eventId: number): RosterAccess {
  const { data } = useQuery(ImsService.method.getAuthStatus, { eventId });
  return rosterAccessFrom(data, eventId);
}

const ADMIN_RUNGS: ParticipationType[] = [
  ParticipationType.WRITER,
  ParticipationType.REPORTER,
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];
const INVITER_RUNGS: ParticipationType[] = [
  ParticipationType.REPORTER,
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];
const NO_LOGIN_RUNGS: ParticipationType[] = [
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];

/**
 * The rungs `access` may set on `person`: the server's ceiling (53b),
 * client-mirrored so the menu never offers what it would refuse. An inviter
 * gets none on a writer's or a crew leader's card; crew leader is derived
 * and never offered.
 */
export function rungsFor(
  access: RosterAccess,
  person: Person,
): ParticipationType[] {
  if (!access.admin && !access.inviteReporters) {
    return [];
  }
  if (
    !access.admin &&
    (person.participationType === ParticipationType.WRITER ||
      person.participationType === ParticipationType.CREW_LEADER)
  ) {
    return [];
  }
  if (!person.hasPassword) {
    return [...NO_LOGIN_RUNGS];
  }
  return access.admin ? [...ADMIN_RUNGS] : [...INVITER_RUNGS];
}

/** Same ceiling as `rungsFor`: "Remove from event" is offered exactly where a rung could be set. */
export function mayRemove(access: RosterAccess, person: Person): boolean {
  return rungsFor(access, person).length > 0;
}
