// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { PersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import {
  makeArea,
  makeIncident,
  makeIncidentType,
  makeIncidentView,
  makeJournalEntry,
} from "@/test/fixtures";

// The D2 round's fixture event (plan 09r). Throwaway; deleted after the pick.

export const EVENT_ID = 1;
export const EVENT_NAME = "2026";
export const ME = 42;

export const me = create(PersonRefSchema, { personId: ME, handle: "Dee" });
const marisol = create(PersonRefSchema, { personId: 3, handle: "Marisol" });
const ray = create(PersonRefSchema, { personId: 2, handle: "Ray" });

function at(iso: string) {
  return timestampFromDate(new Date(iso));
}

export const people: Person[] = [
  { personId: ME, handle: "Dee", name: "Dee Alvarado" },
  { personId: 3, handle: "Marisol", name: "Marisol Quintero" },
  { personId: 2, handle: "Ray", name: "Ray Okafor" },
  { personId: 7, handle: "Tomas", name: "Tomás Lindqvist" },
  { personId: 11, handle: "Priya", name: "Priya Raman" },
  { personId: 12, handle: "", name: "Jules Bertrand" },
  { personId: 15, handle: "Mo", name: "Mohammed Haddad" },
].map((p) => create(PersonSchema, p));

export const areas = [
  ["main-stage", "Main Stage"],
  ["center-camp", "Center Camp"],
  ["front-gate", "Front Gate"],
  ["youth-stage", "Youth Stage"],
  ["xavanadu", "Xavanadu"],
  ["shady-grove", "Shady Grove"],
  ["energy-park", "Energy Park"],
  ["chela-mela", "Chela Mela"],
  ["dragon-loop", "Dragon Loop"],
].map(([slug, name], i) =>
  makeArea({ slug, name, approved: true, sortOrder: i }),
);

export const incidentTypes = [
  [1, "Medical"],
  [2, "Lost Child"],
  [3, "Theft"],
  [4, "Fire"],
  [5, "Water"],
  [6, "Noise"],
  [7, "Vehicle"],
  [8, "Wellness Check"],
  [9, "Conduct"],
  [10, "Hazard"],
].map(([id, name]) =>
  makeIncidentType({ id: id as number, name: name as string }),
);

/** A hidden type stays out of every picker. */
incidentTypes.push(
  makeIncidentType({ id: 11, name: "Wristband Fraud", hidden: true }),
);

export const incidents: IncidentView[] = [
  makeIncidentView({
    viewerMayAddJournal: true,
    incident: makeIncident({
      eventId: EVENT_ID,
      number: 214,
      summary: "Lost child near the main stage, blue jacket, about six",
      state: IncidentState.OPEN,
      priority: IncidentPriority.HIGH,
      started: at("2026-07-11T18:12:00Z"),
      created: at("2026-07-11T18:14:00Z"),
      lastModified: at("2026-07-11T18:42:00Z"),
      createdBy: marisol,
      location: { areaSlug: "main-stage", description: "Sound tent side" },
      incidentTypeIds: [2],
      people: [{ person: me, hasEventAccess: true }],
      journalEntries: [
        makeJournalEntry({
          id: 1,
          author: "Marisol",
          created: at("2026-07-11T18:14:00Z"),
          text: "Parent at the sound tent, child was with her ten minutes ago. Blue jacket, about six. @Dee can you take the loop?",
          mentions: [me],
        }),
        makeJournalEntry({
          id: 2,
          author: "Dee",
          created: at("2026-07-11T18:42:00Z"),
          text: "Walking the loop from Xavanadu back toward the stage.",
        }),
      ],
    }),
  }),
  makeIncidentView({
    viewerMayAddJournal: true,
    incident: makeIncident({
      eventId: EVENT_ID,
      number: 209,
      summary: "Dehydration on the loading crew",
      state: IncidentState.OPEN,
      priority: IncidentPriority.NORMAL,
      started: at("2026-07-11T17:40:00Z"),
      created: at("2026-07-11T17:45:00Z"),
      lastModified: at("2026-07-11T17:55:00Z"),
      createdBy: me,
      location: { areaSlug: "front-gate", booth: "12" },
      incidentTypeIds: [1],
      journalEntries: [
        makeJournalEntry({
          id: 3,
          author: "Dee",
          created: at("2026-07-11T17:45:00Z"),
          text: "Crew member sat down in the shade, water and salt given, medical on the way.",
        }),
      ],
    }),
  }),
  makeIncidentView({
    viewerMayAddJournal: true,
    incident: makeIncident({
      eventId: EVENT_ID,
      number: 198,
      summary: "Generator smell behind Energy Park",
      state: IncidentState.OPEN,
      priority: IncidentPriority.NORMAL,
      started: at("2026-07-11T16:02:00Z"),
      created: at("2026-07-11T16:05:00Z"),
      lastModified: at("2026-07-11T16:30:00Z"),
      createdBy: ray,
      location: { areaSlug: "energy-park" },
      incidentTypeIds: [10],
      journalEntries: [
        makeJournalEntry({
          id: 4,
          author: "Ray",
          created: at("2026-07-11T16:05:00Z"),
          text: "Fuel smell strong near the second generator. @Dee did you have the key for the cage?",
          mentions: [me],
        }),
      ],
    }),
  }),
  makeIncidentView({
    viewerMayAddJournal: true,
    incident: makeIncident({
      eventId: EVENT_ID,
      number: 187,
      summary: "Bike left across the fire lane",
      state: IncidentState.CLOSED,
      priority: IncidentPriority.LOW,
      started: at("2026-07-11T14:10:00Z"),
      created: at("2026-07-11T14:12:00Z"),
      lastModified: at("2026-07-11T14:50:00Z"),
      closed: at("2026-07-11T14:50:00Z"),
      createdBy: ray,
      location: { areaSlug: "shady-grove" },
      incidentTypeIds: [7],
    }),
  }),
  makeIncidentView({
    viewerMayAddJournal: true,
    incident: makeIncident({
      eventId: EVENT_ID,
      number: 176,
      summary: "Welfare check requested by a booth neighbour",
      state: IncidentState.OPEN,
      priority: IncidentPriority.NORMAL,
      private: true,
      started: at("2026-07-11T12:00:00Z"),
      created: at("2026-07-11T12:05:00Z"),
      lastModified: at("2026-07-11T12:05:00Z"),
      createdBy: me,
      location: { areaSlug: "chela-mela", booth: "118" },
      incidentTypeIds: [8],
    }),
  }),
];
