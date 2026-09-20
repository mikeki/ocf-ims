// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import type { Crew } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/crew_pb";
import {
  CrewMemberSchema,
  CrewSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/crew_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  ParticipationType,
  PersonCrewSchema,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { Viewer } from "@/prototypes/people/types";

// Fixture data for the 3c.4 round (docs/plans/09aa-roster-design.md § The
// prototype round): ~60 product-shaped people, no lorem ipsum, deterministic
// (every reload is the same roster). Three crews, one leader across two of
// them; ten reporters on a crew as plain members; eight people with no
// login, half known only by a fair name, half only by a legal name.

export const EVENT = { id: 1, name: "OCF 2026" } as const;

// Fixture content, not a style (a `1x1` PNG used to render as a solid
// circle — 09aa fix): a small inline head-and-shoulders silhouette, a few
// background tints so rows visibly differ from one another.
const AVATAR_TINTS = ["#9CA3AF", "#A78BFA", "#F59E0B", "#34D399"];

function avatarDataUri(personId: number): string {
  const tint = AVATAR_TINTS[personId % AVATAR_TINTS.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${tint}"/>` +
    `<circle cx="32" cy="24" r="12" fill="#ffffff" fill-opacity="0.85"/>` +
    `<path d="M8 60c0-14 10.7-24 24-24s24 10 24 24" fill="#ffffff" fill-opacity="0.85"/>` +
    `</svg>`;
  // Raw, not encodeURIComponent: RN Web encodes a utf8 SVG data URI itself.
  return `data:image/svg+xml;utf8,${svg}`;
}

interface CrewMeta {
  slug: string;
  name: string;
}

const CREWS_META: readonly CrewMeta[] = [
  { slug: "hospitality", name: "Hospitality" },
  { slug: "sanctuary", name: "Sanctuary" },
  { slug: "trailhead", name: "Trailhead" },
];

function crewName(slug: string): string {
  return CREWS_META.find((c) => c.slug === slug)?.name ?? slug;
}

type LoginKind = "handle" | "legal" | undefined;

interface Seed {
  id: number;
  first: string;
  last: string;
  participation: ParticipationType;
  isAdmin?: boolean;
  /** undefined = a normal login; "handle"/"legal" = one of the 8 name-only people. */
  loginless?: LoginKind;
  crews?: { slug: string; isLeader: boolean }[];
  picture?: boolean;
  wristband?: boolean;
}

function build(seed: Seed): Person {
  const fullName = `${seed.first} ${seed.last}`;
  const hasPassword = seed.loginless === undefined;
  const handle =
    seed.loginless === "legal" ? undefined : seed.first.toLowerCase();
  const name = seed.loginless === "handle" ? undefined : fullName;
  return create(PersonSchema, {
    personId: seed.id,
    handle,
    name,
    hasPassword,
    isAdmin: seed.isAdmin ?? false,
    email: hasPassword ? `${seed.first.toLowerCase()}@example.org` : undefined,
    phone: hasPassword
      ? `555-01${String(seed.id).padStart(2, "0")}`
      : undefined,
    profilePictureUrl: seed.picture
      ? seed.id % 2 === 0
        ? avatarDataUri(seed.id)
        : `/blobs/people/${seed.id}/picture.jpg`
      : undefined,
    wristband: seed.wristband
      ? `WB-${String(seed.id).padStart(4, "0")}`
      : undefined,
    participationType: seed.participation,
    crews: (seed.crews ?? []).map((c) =>
      create(PersonCrewSchema, {
        crewName: crewName(c.slug),
        crewSlug: c.slug,
        isLeader: c.isLeader,
      }),
    ),
  });
}

// --- name pools, one row per category, no two people sharing a name ------

const WRITER_NAMES: [string, string][] = [
  ["Ash", "Delacroix"],
  ["Wren", "Castillo"],
  ["Priya", "Novak"],
  ["Owen", "Castellanos"],
  ["Marisol", "Ferreira"],
  ["Dev", "Okonkwo"],
];

const LEADER_NAMES: [string, string][] = [
  ["Sam", "Okafor"],
  ["Logan", "Reyes"],
  ["Amara", "Mensah"],
  ["Kai", "Nakamura"],
];

const REPORTER_NAMES: [string, string][] = [
  ["Talia", "Marchetti"],
  ["Mateo", "Alvarado"],
  ["Yuki", "Tanaka"],
  ["Noor", "Haddad"],
  ["Elan", "Osei"],
  ["Camila", "Bautista"],
  ["Theo", "Papadopoulos"],
  ["Ingrid", "Larsen"],
  ["Basil", "Farrow"],
  ["Farah", "Aziz"],
  ["Soren", "Lindqvist"],
  ["Nadia", "Karimi"],
  ["Colm", "Byrne"],
  ["Ines", "Souza"],
  ["Zane", "Kowalski"],
  ["Petra", "Bashir"],
  ["Cyrus", "Cohen"],
  ["Lior", "Rahman"],
  ["Sana", "Fenwick"],
  ["Rowan", "Moreau"],
  ["Delphine", "Whitaker"],
  ["Jasper", "Beaumont"],
  ["Mireille", "Serrano"],
  ["Tomas", "Chowdhury"],
  ["Anaya", "Bergstrom"],
  ["Felix", "Laurent"],
  ["Odette", "Adeyemi"],
  ["Idris", "Voss"],
  ["Greta", "Kingsley"],
  ["Beau", "Duval"],
  ["Simone", "Whitmore"],
];

const VOLUNTEER_NAMES: [string, string][] = [
  ["Arlo", "Odom"],
  ["Yara", "Kessler"],
  ["Dax", "Renard"],
  ["Isolde", "Baptiste"],
  ["Emil", "Achebe"],
  ["Zora", "Petrov"],
  ["Nikolai", "Lindgren"],
  ["Freya", "Ashby"],
  ["Gideon", "Farouk"],
  ["Layla", "Bellweather"],
  ["Otis", "Sinclair"],
  ["Marguerite", "Haidari"],
];

const PUBLIC_NAMES: [string, string][] = [
  ["Rafi", "Okoye"],
  ["Junia", "Vance"],
  ["Silas", "Delaunay"],
];

const NAME_ONLY_NAMES: [string, string][] = [
  ["Corinne", "Whitcombe"],
  ["Amos", "Reyna"],
  ["Pilar", "Sorensen"],
  ["Dashiell", "Achterberg"],
  ["Selah", "Solano"],
  ["Bram", "Fairweather"],
  ["Coraline", "Whitfield"],
  ["Idalia", "Odell"],
];

let nextId = 101;
function ids(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(nextId + i);
  }
  nextId += count;
  return out;
}

const WRITER_IDS = ids(WRITER_NAMES.length);
const LEADER_IDS = ids(LEADER_NAMES.length);
const REPORTER_IDS = ids(REPORTER_NAMES.length);
const VOLUNTEER_IDS = ids(VOLUNTEER_NAMES.length);
const PUBLIC_IDS = ids(PUBLIC_NAMES.length);
const NAME_ONLY_IDS = ids(NAME_ONLY_NAMES.length);

/** The admin viewer's own identity: a writer, the admin shield. */
export const ADMIN_ID = WRITER_IDS[0] as number;
/** The writer-inviter viewer's own identity: a writer, no crew. */
export const WRITER_INVITER_ID = WRITER_IDS[1] as number;
/** The inviter viewer's own identity: a crew leader, two of the three crews. */
export const INVITER_ID = LEADER_IDS[0] as number;

// Reporters on a crew, as plain members — about ten, spread across the
// three crews round-robin.
const CREWED_REPORTER_INDEXES = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27];

function reporterCrewsFor(index: number): Seed["crews"] {
  const pos = CREWED_REPORTER_INDEXES.indexOf(index);
  if (pos === -1) {
    return undefined;
  }
  const slug = CREWS_META[pos % CREWS_META.length]?.slug;
  return slug ? [{ slug, isLeader: false }] : undefined;
}

const writers: Seed[] = WRITER_NAMES.map(([first, last], i) => ({
  id: WRITER_IDS[i] as number,
  first,
  last,
  participation: ParticipationType.WRITER,
  isAdmin: (WRITER_IDS[i] as number) === ADMIN_ID,
  picture: i % 3 === 0,
  wristband: i % 5 !== 0,
}));

// Sam (index 0) leads Hospitality AND Sanctuary; Logan co-leads Sanctuary;
// Amara and Kai co-lead Trailhead — four distinct crew leaders, three crews.
const LEADER_CREWS: NonNullable<Seed["crews"]>[] = [
  [
    { slug: "hospitality", isLeader: true },
    { slug: "sanctuary", isLeader: true },
  ],
  [{ slug: "sanctuary", isLeader: true }],
  [{ slug: "trailhead", isLeader: true }],
  [{ slug: "trailhead", isLeader: true }],
];

const leaders: Seed[] = LEADER_NAMES.map(([first, last], i) => ({
  id: LEADER_IDS[i] as number,
  first,
  last,
  participation: ParticipationType.CREW_LEADER,
  crews: LEADER_CREWS[i],
  picture: i % 3 === 0,
  wristband: i % 5 !== 0,
}));

const reporters: Seed[] = REPORTER_NAMES.map(([first, last], i) => ({
  id: REPORTER_IDS[i] as number,
  first,
  last,
  participation: ParticipationType.REPORTER,
  crews: reporterCrewsFor(i),
  picture: i % 3 === 0,
  wristband: i % 5 !== 0,
}));

const volunteers: Seed[] = VOLUNTEER_NAMES.map(([first, last], i) => ({
  id: VOLUNTEER_IDS[i] as number,
  first,
  last,
  participation: ParticipationType.VOLUNTEER,
  picture: i % 3 === 0,
  wristband: i % 5 !== 0,
}));

const publicPeople: Seed[] = PUBLIC_NAMES.map(([first, last], i) => ({
  id: PUBLIC_IDS[i] as number,
  first,
  last,
  participation: ParticipationType.PUBLIC,
  picture: i % 3 === 0,
  wristband: i % 5 !== 0,
}));

// The 8 name-only people (§ The prototype round): no `has_password`, half
// known only by a fair name (a handle, no legal name), half only by a legal
// name (no handle) — split across volunteer/public.
const nameOnly: Seed[] = NAME_ONLY_NAMES.map(([first, last], i) => ({
  id: NAME_ONLY_IDS[i] as number,
  first,
  last,
  participation: i < 5 ? ParticipationType.VOLUNTEER : ParticipationType.PUBLIC,
  loginless: i % 2 === 0 ? "handle" : "legal",
  picture: i % 3 === 0,
  wristband: i % 5 !== 0,
}));

export const PEOPLE: Person[] = [
  ...writers,
  ...leaders,
  ...reporters,
  ...volunteers,
  ...publicPeople,
  ...nameOnly,
].map(build);

function personRef(id: number) {
  const p = PEOPLE.find((person) => person.personId === id);
  return create(PersonRefSchema, {
    personId: id,
    handle: p?.handle,
    name: p?.name,
  });
}

/** The full crew roster, members and leaders together — `ListMyCrews` filters this live by the caller's own leadership. */
export const CREWS: Crew[] = CREWS_META.map((meta) => {
  const members = PEOPLE.filter((p) =>
    p.crews.some((c) => c.crewSlug === meta.slug),
  ).map((p) => {
    const membership = p.crews.find((c) => c.crewSlug === meta.slug);
    return create(CrewMemberSchema, {
      person: personRef(p.personId),
      isLeader: membership?.isLeader === true,
    });
  });
  return create(CrewSchema, { slug: meta.slug, name: meta.name, members });
});

export interface Identity {
  personId: number;
  handle: string;
  admin: boolean;
  /** AccessForEvent.invite_reporters (53a) — the fake has no such FakeUser bit; fake.ts wraps it in. */
  canInvite: boolean;
  writeIncidents: boolean;
  writeReports: boolean;
}

export function identityFor(viewer: Viewer): Identity {
  switch (viewer) {
    case "admin":
      return {
        personId: ADMIN_ID,
        handle: "ash",
        admin: true,
        canInvite: false,
        writeIncidents: true,
        writeReports: true,
      };
    case "inviter":
      return {
        personId: INVITER_ID,
        handle: "sam",
        admin: false,
        canInvite: true,
        writeIncidents: false,
        writeReports: false,
      };
    case "writerInviter":
      return {
        personId: WRITER_INVITER_ID,
        handle: "wren",
        admin: false,
        canInvite: true,
        writeIncidents: true,
        writeReports: true,
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
    writeReports: id.writeReports,
    readAreas: true,
    attachFiles: true,
  };
}
