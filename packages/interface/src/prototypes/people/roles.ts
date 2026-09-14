// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";

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
