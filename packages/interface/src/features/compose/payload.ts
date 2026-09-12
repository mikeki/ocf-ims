// SPDX-License-Identifier: Apache-2.0

import { create, toJson } from "@bufbuild/protobuf";
import type { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { Report } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import { ReportSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import type {
  CreateIncidentRequest,
  IncidentUpdate,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import {
  CreateIncidentRequestSchema,
  IncidentUpdateSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import type { CreateReportRequest } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { CreateReportRequestSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";

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
  /** Reports to link on create — "create an incident from this report" (09t). */
  reportNumbers?: number[];
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
      ...(form.reportNumbers && form.reportNumbers.length > 0
        ? { reports: { values: form.reportNumbers } }
        : {}),
      journalEntries: form.entry ? [entryOf(form.entry)] : [],
    },
  });
}

/** A report entry: the text, its mentions, and who it is about when filed for someone else (6m). */
export interface ReportEntryInput extends EntryInput {
  onBehalfOfId?: number;
}

export interface ReportForm {
  summary: string;
  /** A positive number links the report on create; the server writes both timelines. */
  incident?: number;
  entry?: ReportEntryInput;
}

/** One CreateReport, the first entry aboard (09t). */
export function reportRequest(
  eventId: number,
  form: ReportForm,
): CreateReportRequest {
  const summary = form.summary.trim();
  return create(CreateReportRequestSchema, {
    eventId,
    report: {
      ...(summary ? { summary } : {}),
      ...(form.incident && form.incident > 0
        ? { incident: form.incident }
        : {}),
      journalEntries: form.entry ? [reportEntryOf(form.entry)] : [],
    },
  });
}

/** One UpdateReport body with ONLY journal_entries set: the summary and the link stay. */
export function reportAppend(entry: ReportEntryInput): Report {
  return create(ReportSchema, { journalEntries: [reportEntryOf(entry)] });
}

/** One UpdateReport body that sets the link (a positive number) and nothing else. */
export function reportLink(incident: number): Report {
  return create(ReportSchema, { incident });
}

function reportEntryOf(entry: ReportEntryInput) {
  return {
    text: entry.text.trim(),
    mentions: entry.mentionIds.map((personId) => ({ personId })),
    ...(entry.onBehalfOfId
      ? { onBehalfOf: { personId: entry.onBehalfOfId } }
      : {}),
  };
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
