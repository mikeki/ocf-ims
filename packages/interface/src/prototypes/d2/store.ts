// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { IncidentState } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { useCallback, useRef, useState } from "react";
import {
  EVENT_ID,
  EVENT_NAME,
  me,
  people,
  areas as seedAreas,
  incidents as seedIncidents,
  incidentTypes as seedTypes,
} from "@/prototypes/d2/data";
import {
  makeArea,
  makeIncident,
  makeIncidentType,
  makeIncidentView,
  makeJournalEntry,
} from "@/test/fixtures";

// An in-memory ImsService for the D2 round: the five write RPCs with the
// server's semantics (09r "What is already true on the wire"), so every
// variant's flow can be walked end to end with no server.

export interface FileInput {
  summary: string;
  priority: IncidentPriority;
  typeIds: number[];
  areaSlug?: string;
  description?: string;
  booth?: string;
  entry?: { text: string; mentionIds: number[] };
}

export interface FakeIms {
  incidents: IncidentView[];
  areas: Area[];
  types: IncidentType[];
  people: Person[];
  /** CreateIncident: returns the new number. */
  file(input: FileInput): number;
  /** UpdateIncident with only journal_entries. */
  append(number: number, text: string, mentionIds: number[]): void;
  /** ProposeIncidentType: a name collision resolves to the existing id. */
  proposeType(name: string): number;
  /** CreateArea: a writer's is a proposal; returns the slug. */
  createArea(name: string): string;
  /** ListPersonnel{query}: under two characters answers nothing. */
  search(query: string): Person[];
}

export function useFakeIms(): FakeIms {
  const [incidents, setIncidents] = useState(seedIncidents);
  const [areas, setAreas] = useState(seedAreas);
  const [types, setTypes] = useState(seedTypes);
  const nextEntryId = useRef(100);

  const file = useCallback(
    (input: FileInput) => {
      const number =
        Math.max(0, ...incidents.map((v) => v.incident?.number ?? 0)) + 1;
      const now = timestampFromDate(new Date());
      const entries = input.entry
        ? [
            makeJournalEntry({
              id: nextEntryId.current++,
              author: me.handle,
              created: now,
              text: input.entry.text,
              mentions: refsFor(input.entry.mentionIds),
            }),
          ]
        : [];
      const view = makeIncidentView({
        viewerMayAddJournal: true,
        incident: makeIncident({
          event: EVENT_NAME,
          eventId: EVENT_ID,
          number,
          created: now,
          started: now,
          lastModified: now,
          state: IncidentState.OPEN,
          priority: input.priority,
          summary: input.summary || undefined,
          createdBy: me,
          location: {
            areaSlug: input.areaSlug,
            description: input.description || undefined,
            booth: input.booth || undefined,
          },
          incidentTypeIds: input.typeIds,
          journalEntries: entries,
        }),
      });
      setIncidents((all) => [view, ...all]);
      return number;
    },
    [incidents],
  );

  const append = useCallback(
    (number: number, text: string, mentionIds: number[]) => {
      const now = timestampFromDate(new Date());
      const entry = makeJournalEntry({
        id: nextEntryId.current++,
        author: me.handle,
        created: now,
        text,
        mentions: refsFor(mentionIds),
      });
      setIncidents((all) =>
        all.map((view) => {
          if (!view.incident || view.incident.number !== number) {
            return view;
          }
          return {
            ...view,
            incident: {
              ...view.incident,
              lastModified: now,
              journalEntries: [...view.incident.journalEntries, entry],
            },
          };
        }),
      );
    },
    [],
  );

  const proposeType = useCallback(
    (name: string) => {
      const wanted = name.trim().toLowerCase();
      const existing = types.find(
        (t) => (t.name ?? "").trim().toLowerCase() === wanted,
      );
      if (existing) {
        return existing.id;
      }
      const id = Math.max(0, ...types.map((t) => t.id)) + 1;
      setTypes((all) => [
        ...all,
        makeIncidentType({
          id,
          name: name.trim(),
          approved: false,
          proposer: me,
        }),
      ]);
      return id;
    },
    [types],
  );

  const createArea = useCallback(
    (name: string) => {
      const wanted = name.trim().toLowerCase();
      const existing = areas.find(
        (a) => (a.name ?? "").trim().toLowerCase() === wanted,
      );
      if (existing) {
        return existing.slug;
      }
      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      setAreas((all) => [
        ...all,
        makeArea({
          slug,
          name: name.trim(),
          approved: false,
          proposer: me,
          sortOrder: all.length,
        }),
      ]);
      return slug;
    },
    [areas],
  );

  const search = useCallback((query: string) => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      return [];
    }
    return people.filter(
      (p) =>
        (p.handle ?? "").toLowerCase().includes(q) ||
        (p.name ?? "").toLowerCase().includes(q),
    );
  }, []);

  return {
    incidents,
    areas,
    types,
    people,
    file,
    append,
    proposeType,
    createArea,
    search,
  };
}

function refsFor(ids: number[]) {
  return ids.flatMap((id) => {
    const p = people.find((person) => person.personId === id);
    return p
      ? [
          create(PersonRefSchema, {
            personId: id,
            handle: p.handle,
            name: p.name,
          }),
        ]
      : [];
  });
}
