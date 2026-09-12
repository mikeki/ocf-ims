// SPDX-License-Identifier: Apache-2.0

import { create, toJson } from "@bufbuild/protobuf";
import type { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type {
  CreateIncidentRequest,
  IncidentUpdate,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import {
  CreateIncidentRequestSchema,
  IncidentUpdateSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";

// The two write bodies (plan 09r § The write payloads). `IncidentUpdate` is
// presence-tracked, so what is NOT set matters: an append carries the entry
// and nothing else, or a granted reporter's append is refused.

export interface EntryInput {
  text: string;
  mentionIds: number[];
}

export interface IncidentForm {
  summary: string;
  priority: IncidentPriority;
  typeIds: number[];
  areaSlug?: string;
  description: string;
  booth: string;
  entry?: EntryInput;
}

/** One CreateIncident, the first entry aboard. */
export function fileRequest(
  eventId: number,
  form: IncidentForm,
): CreateIncidentRequest {
  const summary = form.summary.trim();
  const description = form.description.trim();
  const booth = form.booth.trim();
  const hasLocation = Boolean(form.areaSlug || description || booth);
  return create(CreateIncidentRequestSchema, {
    eventId,
    incident: {
      priority: form.priority,
      ...(summary ? { summary } : {}),
      ...(form.typeIds.length > 0
        ? { incidentTypeIds: { values: form.typeIds } }
        : {}),
      ...(hasLocation
        ? {
            location: {
              ...(form.areaSlug ? { areaSlug: form.areaSlug } : {}),
              ...(description ? { description } : {}),
              ...(booth ? { booth } : {}),
            },
          }
        : {}),
      journalEntries: form.entry ? [entryOf(form.entry)] : [],
    },
  });
}

/** One UpdateIncident body with ONLY journal_entries set. */
export function appendUpdate(entry: EntryInput): IncidentUpdate {
  return create(IncidentUpdateSchema, { journalEntries: [entryOf(entry)] });
}

function entryOf(entry: EntryInput) {
  return { text: entry.text.trim(), mentionedPersonIds: entry.mentionIds };
}

/** Mirrors the server's isJournalOnly: entries present, every other field absent. */
export function isJournalOnly(update: IncidentUpdate): boolean {
  const json = toJson(IncidentUpdateSchema, update) as Record<string, unknown>;
  const keys = Object.keys(json);
  return (
    update.journalEntries.length > 0 &&
    keys.length === 1 &&
    keys[0] === "journalEntries"
  );
}
