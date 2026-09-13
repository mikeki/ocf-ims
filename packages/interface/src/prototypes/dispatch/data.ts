// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { PersonRef } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type {
  Incident,
  IncidentPerson,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  IncidentPersonSchema,
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import {
  makeArea,
  makeIncident,
  makeIncidentType,
  makeJournalEntry,
} from "@/test/fixtures";

// The D2 round's fixture event (plan 09x): a fair-scale Saturday evening,
// generated deterministically so every reload is the same table. Throwaway;
// deleted after the pick.

export const EVENT = { id: 1, name: "OCF 2026" } as const;
export const ME = 42;
export const ALERTS_UNREAD = 3;
/** The incident with the long journal the brief asks for. */
export const LONG_JOURNAL_NUMBER = 173;
/** How many incidents the event holds — above the 185 the brief sets. */
export const ROW_COUNT = 196;

export const me: PersonRef = create(PersonRefSchema, {
  personId: ME,
  handle: "Dee",
  name: "Dee Alvarado",
});

const HANDLES: [number, string, string][] = [
  [ME, "Dee", "Dee Alvarado"],
  [2, "Ray", "Ray Okafor"],
  [3, "Marisol", "Marisol Quintero"],
  [7, "Tomas", "Tomás Lindqvist"],
  [11, "Priya", "Priya Raman"],
  [12, "Jules", "Jules Bertrand"],
  [15, "Mo", "Mohammed Haddad"],
  [18, "Sky", "Skyler Dunn"],
  [21, "Wren", "Wren Castillo"],
  [24, "Ozzie", "Osvaldo Reyes"],
  [27, "Bea", "Beatriz Nunes"],
  [30, "Hollis", "Hollis Grant"],
  [33, "Kit", "Kit Yamamoto"],
  [36, "Fern", "Fern Delacroix"],
];

export const people: PersonRef[] = HANDLES.map(([personId, handle, name]) =>
  create(PersonRefSchema, { personId, handle, name }),
);

export const types: IncidentType[] = [
  "Medical",
  "Lost child",
  "Lost person",
  "Fire",
  "Theft",
  "Vehicle",
  "Welfare check",
  "Noise",
  "Ejection",
  "Alcohol / drugs",
  "Assist",
  "Found property",
  "Other",
].map((name, i) => makeIncidentType({ id: i + 1, name }));

export const areas: Area[] = [
  ["main-stage", "Main Stage"],
  ["front-gate", "Front Gate"],
  ["xavanadu", "Xavanadu"],
  ["energy-park", "Energy Park"],
  ["shady-grove", "Shady Grove"],
  ["chela-mela", "Chela Mela"],
  ["dragons-head", "Dragon's Head"],
  ["youth-stage", "Youth Stage"],
  ["circus", "Circus"],
  ["crafts-lot", "Crafts Lot"],
  ["far-side", "Far Side"],
  ["wine-booth", "Wine Booth"],
  ["community-village", "Community Village"],
  ["ritz-sauna", "Ritz Sauna"],
  ["bus-loop", "Bus Loop"],
  ["dead-end", "Dead End"],
].map(([slug, name]) => makeArea({ slug, name }));

const SUMMARIES = [
  "Lost child near the main stage, red shirt, about six",
  "Heat exhaustion at the front gate line",
  "Bicycle found unlocked behind the Ritz",
  "Noise complaint from the neighbours on the north fence",
  "Fall from a ladder at the crafts lot, conscious, wrist pain",
  "Vendor reports a wallet taken from a booth counter",
  "Intoxicated person asleep in the bus loop shelter",
  "Sparks from a generator behind the food court, no flames",
  "Person separated from their group after the parade",
  "Vehicle blocking the emergency lane by the wine booth",
  "Allergic reaction at the youth stage, epi pen used, breathing fine now, family present and asking for a ride to the medical tent",
  "Dog off leash near the sauna",
  "Wristband dispute at the far side gate",
  "Suspected dehydration, elderly, sitting in the shade at Shady Grove",
  "Smoke from a campfire in the no-fire zone",
  "Camper says a tent was entered overnight, phone and cash gone",
  "Person with a cut hand from a broken glass at the circus",
  "Argument escalating between two vendors on Xavanadu",
  "Lost keys handed in at the info booth",
  "Request for a wheelchair escort from the bus loop to the main stage",
  "Bee sting, no known allergy, asking for ice",
  "Unattended bag by the stage left barricade",
  "Teenager found who was reported missing at 14:10",
  "Fence down on the south side of Energy Park",
  "Overheated child in a stroller, parents cooling at the water station",
  "Fireworks heard past the dead end, nothing found on walk",
  "Person reports being followed from the crafts lot, wants to talk to someone",
  "Water leak flooding the path to Community Village",
  "Lost hearing aid, blue case, somewhere between the two stages",
  "Radio found on a bench, channel two, no name on it",
  "Ejection requested by a vendor for a repeat shoplifter, description given",
  "Man collapsed at Dragon's Head, breathing, medics on the way",
  "Bike vs pedestrian on the bus loop path, minor scrapes, both refusing care",
  "Power out in the whole crafts lot after a breaker tripped twice in an hour, vendors asking whether to close",
  "Wandering elder, says she is looking for her daughter's booth",
  "Broken glass swept but more under the tables at the wine booth",
  "Lost wallet, green, contains an out-of-state licence",
  "Two children found without an adult, both fine, one is crying",
  "Golf cart tipped on the far side hill, driver okay",
  "Odor of gas near the food vendor row, nobody sure which stall",
];

const ENTRIES = [
  "Rangers dispatched, ETA five minutes.",
  "On scene. Assessing.",
  "Talked to the reporting party, story checks out.",
  "Medical is aware and has a team en route.",
  "Located. Reuniting with family at the info booth.",
  "Cleared the area, no further action needed.",
  "Called back in by radio, no change.",
  "Vendor will file a written report tomorrow.",
  "Escort provided to the parking lot.",
  "Handed off to the night shift lead.",
  "Second call from the same location, same party.",
  "Photo of the item attached below.",
  "Follow-up at 20:00 if not resolved.",
  "Nothing found on a second walk of the area.",
  "Closing this one. Reopen if it comes back.",
];

const SYSTEM_ENTRIES = [
  "Changed state: new → open",
  "Changed priority: normal → high",
  "Changed area: Main Stage",
  "Added type: Medical",
  "Attached person: Ray",
  "Changed state: open → closed",
];

/** mulberry32: a tiny seeded PRNG, so the table is the same on every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, from: readonly T[]): T {
  const item = from[Math.floor(random() * from.length)];
  if (item === undefined) {
    throw new Error("pick from an empty list");
  }
  return item;
}

function ts(ms: number) {
  return timestampFromDate(new Date(ms));
}

const HOUR = 3_600_000;

/** Every incident in the event, oldest number first. */
export function buildIncidents(now = Date.now()): Incident[] {
  const random = rng(0x0c0ffee);
  const spanStart = now - 3 * 24 * HOUR;
  const out: Incident[] = [];
  let entryId = 1;

  for (let n = 1; n <= ROW_COUNT; n++) {
    // Numbers are handed out in time order, so earlier numbers are older.
    const started =
      spanStart + ((n - 1) / ROW_COUNT) * (now - spanStart) - random() * HOUR;
    const created = started + random() * 0.4 * HOUR;
    const ageHours = (now - started) / HOUR;
    // Older incidents are mostly closed; the last few hours are mostly open.
    const closed = random() < Math.min(0.92, ageHours / 30);
    const r = random();
    const priority =
      r < 0.11
        ? IncidentPriority.HIGH
        : r < 0.27
          ? IncidentPriority.LOW
          : IncidentPriority.NORMAL;
    const typeCount = random() < 0.55 ? 1 : random() < 0.7 ? 2 : 3;
    const typeIds = new Set<number>();
    while (typeIds.size < typeCount) {
      typeIds.add(pick(random, types).id);
    }
    const peopleCount =
      random() < 0.2 ? 0 : random() < 0.6 ? 1 : random() < 0.6 ? 2 : 4;
    const attached = new Set<PersonRef>();
    while (attached.size < peopleCount) {
      attached.add(pick(random, people));
    }
    const incidentPeople: IncidentPerson[] = [...attached].map((person) =>
      create(IncidentPersonSchema, {
        person,
        hasEventAccess: true,
        involvement: random() < 0.3 ? "reporting party" : undefined,
      }),
    );
    const lastModified = closed
      ? created + random() * Math.min(6 * HOUR, now - created)
      : created + random() * Math.min(2 * HOUR, now - created);

    const entryCount =
      n === LONG_JOURNAL_NUMBER ? 30 : 1 + Math.floor(random() * 5);
    const journal: JournalEntry[] = [];
    let at = created;
    for (let i = 0; i < entryCount; i++) {
      at += random() * ((lastModified - created) / entryCount);
      const system = i > 0 && random() < 0.3;
      journal.push(
        makeJournalEntry({
          id: entryId++,
          created: ts(at),
          author: pick(random, people).handle ?? "Dee",
          systemEntry: system,
          text: system ? pick(random, SYSTEM_ENTRIES) : pick(random, ENTRIES),
        }),
      );
    }

    out.push(
      makeIncident({
        event: EVENT.name,
        eventId: EVENT.id,
        number: n,
        created: ts(created),
        started: ts(started),
        lastModified: ts(lastModified),
        closed: closed ? ts(lastModified) : undefined,
        createdBy: pick(random, people),
        state: closed ? IncidentState.CLOSED : IncidentState.OPEN,
        priority,
        private: random() < 0.07,
        summary: pick(random, SUMMARIES),
        location: {
          areaSlug: random() < 0.9 ? pick(random, areas).slug : undefined,
        },
        incidentTypeIds: [...typeIds],
        people: incidentPeople,
        journalEntries: journal,
      }),
    );
  }
  return out;
}

/** The viewer's access on the fixture event: a dispatcher, so everything. */
export const access = {
  writeIncidents: true,
  attachFiles: true,
} as const;
