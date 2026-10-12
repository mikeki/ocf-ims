// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useAuthStatus } from "@/features/events/hooks";
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

/** The viewer's roster access for one event; the one GetAuthStatus observer (`useAuthStatus`) `useEventAccess` shares. */
export function useRosterAccess(eventId: number): RosterAccess {
  const { data } = useAuthStatus(eventId);
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
  // `has_password` is on the wire for a personnel admin only; an inviter is
  // told nothing, so "No login" (Volunteer / Public) is the admin's alone.
  if (access.admin && !person.hasPassword) {
    return [...NO_LOGIN_RUNGS];
  }
  return access.admin ? [...ADMIN_RUNGS] : [...INVITER_RUNGS];
}

/** Same ceiling as `rungsFor`: "Remove from event" is offered exactly where a rung could be set. */
export function mayRemove(access: RosterAccess, person: Person): boolean {
  return rungsFor(access, person).length > 0;
}
