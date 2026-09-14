// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { PersonRef } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  ParticipationType,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { Report } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import { ReportSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import type { ReportView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { ReportViewSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import type { Viewer } from "@/prototypes/reports/types";
import {
  makeIncident,
  makeIncidentView,
  makeJournalEntry,
} from "@/test/fixtures";

// Fixture data for the 3c.3 round (docs/plans/09z-reports-design.md § The
// prototype round), product-shaped and deterministic — every reload is the
// same event. The viewer stays the SAME account (Dee, personId 42) across
// the dispatcher / reporter / admin roles — only the permission bits change,
// as the round's harness describes it ("the runtime is rebuilt per viewer").
// The crew leader is the one exception: a crew leader reviewing their crew's
// reports never wrote any of the three fixtures, so making that a distinct
// identity (Sam, 999) is what actually earns "every one read-only" — Dee
// authored R-3, and the wire's own rule (may_add_journal_entry = creator,
// writer or admin) would otherwise hand the crew leader a composer on their
// own report regardless of the write bit. Recorded here rather than in the
// brief because it only surfaces once the fixtures are built.

export const EVENT = { id: 1, name: "OCF 2026" } as const;
export const ME = 42;
const CREW_LEADER = 999;

const day = (hm: string) => timestampFromDate(new Date(`2026-09-12T${hm}Z`));

const dee: PersonRef = create(PersonRefSchema, {
  personId: ME,
  handle: "Dee",
});
const sam: PersonRef = create(PersonRefSchema, {
  personId: CREW_LEADER,
  handle: "Sam",
  name: "Sam Okafor",
});
const marisol: PersonRef = create(PersonRefSchema, {
  personId: 201,
  handle: "marisol",
  name: "Marisol Vega",
});
const kai: PersonRef = create(PersonRefSchema, {
  personId: 202,
  handle: "kai",
  name: "Kai Nakamura",
});
const owen: PersonRef = create(PersonRefSchema, {
  personId: 203,
  handle: "owen",
  name: "Owen Castellanos",
});
const priya: PersonRef = create(PersonRefSchema, {
  personId: 204,
  handle: "priya",
  name: "Priya Shah",
});
const logan: PersonRef = create(PersonRefSchema, {
  personId: 205,
  handle: "logan",
  name: "Logan Reyes",
});

function person(ref: PersonRef, participation: ParticipationType): Person {
  return create(PersonSchema, {
    personId: ref.personId,
    handle: ref.handle,
    name: ref.name,
    hasPassword: true,
    isAdmin: false,
    participationType: participation,
  });
}

/** Enough people for the on-behalf-of picker and "created by" (§ The prototype round). */
export const PEOPLE: Person[] = [
  person(dee, ParticipationType.WRITER),
  person(sam, ParticipationType.CREW_LEADER),
  person(marisol, ParticipationType.REPORTER),
  person(kai, ParticipationType.VOLUNTEER),
  person(owen, ParticipationType.REPORTER),
  person(priya, ParticipationType.WRITER),
  person(logan, ParticipationType.REPORTER),
];

function entry(
  overrides: Parameters<typeof makeJournalEntry>[0],
): JournalEntry {
  return makeJournalEntry(overrides);
}

// Incident #47: the report round's one visible incident — every field set
// enough to show summary, state, priority, area, and ~8 entries across a
// few hours (§ The prototype round).
export const INCIDENT_47: Incident = makeIncident({
  eventId: EVENT.id,
  event: EVENT.name,
  number: 47,
  created: day("18:05:00"),
  started: day("18:05:00"),
  lastModified: day("19:40:00"),
  state: IncidentState.OPEN,
  priority: IncidentPriority.HIGH,
  createdBy: priya,
  summary: "Two friends separated near Center Camp during the evening set",
  location: { areaSlug: "center-camp", description: "Near the info booth" },
  reports: [7],
  journalEntries: [
    entry({
      id: 4701,
      created: day("18:05:00"),
      author: "priya",
      text: "Two friends separated in the crowd near Center Camp during the evening set.",
    }),
    entry({
      id: 4702,
      created: day("18:12:00"),
      author: "priya",
      text: "Dispatched a Ranger to walk the gate perimeter with a description.",
    }),
    entry({
      id: 4703,
      created: day("18:20:00"),
      author: "priya",
      text: "Description relayed to gate volunteers: teal jacket, backpack with patches.",
    }),
    entry({
      id: 4704,
      created: day("18:45:00"),
      author: "priya",
      text: "No sign near the gate; checking Medical in case they came in on their own.",
    }),
    entry({
      id: 4705,
      created: day("19:10:00"),
      author: "priya",
      text: "Located at Medical, mild dehydration, resting comfortably.",
    }),
    entry({
      id: 4706,
      created: day("19:15:00"),
      author: "priya",
      text: "Friend notified and on the way to Medical.",
    }),
    entry({
      id: 4707,
      created: day("19:30:00"),
      author: "priya",
      text: "Both accounted for; closing out shortly.",
    }),
    entry({
      id: 4708,
      created: day("19:40:00"),
      author: "priya",
      text: "Follow-up: pair given water and a check-in reminder for tomorrow.",
    }),
  ],
});
export const INCIDENT_47_VIEW: IncidentView = makeIncidentView({
  incident: INCIDENT_47,
  viewerMayAddJournal: false,
});

/**
 * Incident #48: private, not created by the viewer, kept OUT of every
 * viewer's `fake.incidents` (data.ts, Harness.tsx) so `GetIncident` answers
 * NotFound for it (§ The prototype round) — the shape a Companion-style
 * column's "Not visible to you" state would read against. No report links
 * to it among the round's three fixtures; a second builder wanting to
 * exercise that column live will need to link a fixture report to this
 * number themselves (a finding, not built here — see the builder's report).
 */
export const PRIVATE_INCIDENT_48: Incident = makeIncident({
  eventId: EVENT.id,
  event: EVENT.name,
  number: 48,
  created: day("20:15:00"),
  started: day("20:15:00"),
  lastModified: day("20:20:00"),
  state: IncidentState.OPEN,
  priority: IncidentPriority.NORMAL,
  private: true,
  createdBy: logan,
  summary: "Camp dispute reported near the north gate",
  journalEntries: [
    entry({
      id: 4801,
      created: day("20:15:00"),
      author: "logan",
      text: "Report of raised voices between two camps near the north gate.",
    }),
    entry({
      id: 4802,
      created: day("20:20:00"),
      author: "logan",
      text: "Both parties separated for the night; following up in the morning.",
    }),
  ],
});

// R-7: linked to #47, by a reporter who is not the viewer — six entries: one
// on behalf of another person, one with a photo, one stricken, two system
// entries, the rest prose.
export const R7: Report = create(ReportSchema, {
  event: EVENT.name,
  number: 7,
  created: day("18:07:00"),
  createdBy: marisol,
  summary: "Two friends reunited near Center Camp Medical",
  incident: 47,
  journalEntries: [
    entry({
      id: 701,
      created: day("18:07:00"),
      author: "marisol",
      text: "Approached at the Center Camp sound booth by a visitor looking for a friend they'd lost in the crowd.",
    }),
    entry({
      id: 702,
      created: day("18:22:00"),
      author: "marisol",
      onBehalfOf: kai,
      text: "Gate volunteer radioed that a match to the description just walked through — teal jacket, backpack.",
    }),
    entry({
      id: 703,
      created: day("18:25:00"),
      author: "marisol",
      systemEntry: true,
      text: "Linked to incident #47",
    }),
    entry({
      id: 704,
      created: day("18:40:00"),
      author: "marisol",
      text: "Photo of the description card left with the gate volunteers.",
      attachment: {
        id: "description-card.jpg",
        previewable: true,
        mediaType: "image/jpeg",
      },
    }),
    entry({
      id: 705,
      created: day("19:00:00"),
      author: "marisol",
      text: "Possible sighting reported near the food court.",
      stricken: true,
    }),
    entry({
      id: 706,
      created: day("19:35:00"),
      author: "marisol",
      systemEntry: true,
      text: "Changed summary to: Two friends reunited near Center Camp Medical.",
    }),
  ],
});

// R-12: standalone — the one dispatch must find a home for.
export const R12: Report = create(ReportSchema, {
  event: EVENT.name,
  number: 12,
  created: day("20:05:00"),
  createdBy: owen,
  summary: "A wallet turned in at the info booth, no ID inside",
  journalEntries: [
    entry({
      id: 1201,
      created: day("20:05:00"),
      author: "owen",
      text: "Visitor turned in a wallet found near the Bandshell; no ID, about $40 cash inside.",
    }),
    entry({
      id: 1202,
      created: day("20:07:00"),
      author: "owen",
      text: "Placed in the Lost & Found lockbox at Ops; will hold through the weekend.",
    }),
  ],
});

// R-3: the viewer's own, when the viewer is the reporter.
export const R3: Report = create(ReportSchema, {
  event: EVENT.name,
  number: 3,
  created: day("18:50:00"),
  createdBy: dee,
  summary: "The water station near Center Camp is empty; refill requested",
  journalEntries: [
    entry({
      id: 301,
      created: day("18:50:00"),
      author: "Dee",
      text: "Checked the water station near Center Camp — empty since around 6pm.",
    }),
    entry({
      id: 302,
      created: day("18:52:00"),
      author: "Dee",
      text: "Refill crew radioed, ETA 20 minutes.",
    }),
  ],
});

interface Identity {
  personId: number;
  handle: string;
  admin: boolean;
  /** EventWriteAllReports — may add a journal entry to any report, may not necessarily edit its summary. */
  writeAll: boolean;
  /** EventWriteOwnReports or better — the write gate for the link control (§ Gating). */
  anyWrite: boolean;
  writeIncidents: boolean;
}

function identityFor(viewer: Viewer): Identity {
  switch (viewer) {
    case "dispatcher":
      return {
        personId: ME,
        handle: "Dee",
        admin: false,
        writeAll: true,
        anyWrite: true,
        writeIncidents: true,
      };
    case "reporter":
      return {
        personId: ME,
        handle: "Dee",
        admin: false,
        writeAll: false,
        anyWrite: true,
        writeIncidents: false,
      };
    case "crewLeader":
      return {
        personId: CREW_LEADER,
        handle: "Sam",
        admin: false,
        writeAll: false,
        anyWrite: false,
        writeIncidents: false,
      };
    case "admin":
      return {
        personId: ME,
        handle: "Dee",
        admin: true,
        writeAll: true,
        anyWrite: true,
        writeIncidents: true,
      };
  }
}

/** The FakeUser overrides createFakeIms() takes for this viewer (Harness.tsx). */
export function userOverridesFor(viewer: Viewer) {
  const id = identityFor(viewer);
  return {
    personId: id.personId,
    handle: id.handle,
    admin: id.admin,
    writeIncidents: id.writeIncidents,
    writeReports: id.anyWrite,
    readAreas: true,
    attachFiles: true,
  };
}

/** `may_edit_summary` / `may_add_journal_entry`, the server's rules (§ Gating). */
function viewOf(report: Report, viewer: Viewer): ReportView {
  const id = identityFor(viewer);
  const isCreator = report.createdBy?.personId === id.personId;
  return create(ReportViewSchema, {
    report,
    mayEditSummary: isCreator || id.admin,
    mayAddJournalEntry: isCreator || id.writeAll || id.admin,
  });
}

/**
 * The reports a viewer's `ListReports` answers (data.ts stands in for the
 * server's three-way scoping test, § What is already true on the wire — the
 * wire itself says nothing about which rule admitted a report). The
 * reporter sees only their own, R-3; every other viewer sees the full three.
 */
export function reportsForViewer(viewer: Viewer): ReportView[] {
  if (viewer === "reporter") {
    return [viewOf(R3, viewer)];
  }
  return [viewOf(R7, viewer), viewOf(R12, viewer), viewOf(R3, viewer)];
}

/** Incident #47 is the only one ever in a viewer's `fake.incidents` — #48 stays out (its own comment above). */
export function incidentsForViewer(): IncidentView[] {
  return [INCIDENT_47_VIEW];
}
