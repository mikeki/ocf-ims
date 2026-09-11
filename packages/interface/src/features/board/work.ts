// SPDX-License-Identifier: Apache-2.0

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import type { ReportView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";

// The Board's domain logic (plan 09q, slice 3b.1): who an item belongs to,
// when it last changed, and what it is called. All pure — the screen decides
// how to arrange these, the watermark (seen.ts) decides which are unread.
//
// "Mine" is computed on the client, deliberately (09i §8, 3b.1: "client-side;
// a server filter is a noted follow-up"): the cost is that the response
// carries every incident in the event with its journal, and the phone throws
// most of it away.

/** One row on the Board: an incident or a report, flattened. */
export interface WorkItem {
  kind: "incident" | "report";
  /** The per-event number. Unique only WITHIN its kind. */
  number: number;
  summary: string;
  /** An area name or a location description. Reports have no location. */
  where?: string;
  /** Whether it is mine at all. `why` is meaningless when this is false. */
  mine: boolean;
  /** Why it is mine. More than one rule can hold; this is the first that did. */
  why: MineReason;
  state?: "open" | "closed";
  priority?: "high" | "normal" | "low";
  private?: boolean;
  /** The comparison key, and the sort key. See changedAt* below. */
  changedAt: number;
}

export type MineReason = "created" | "attached" | "mentioned";

export const whyLabel: Readonly<Record<MineReason, string>> = {
  created: "You filed",
  attached: "You're on it",
  mentioned: "Mentions you",
};

/**
 * How a record is written down and called out loud: `#214` for an incident,
 * `R-38` for a report.
 *
 * An incident and a report can both be 214 in the same event, so something has
 * to separate them — but only one of the two needs to carry the mark.
 * Incidents are the record the fair runs on, and the one the app and the radio
 * already call `#214`; marking only reports buys the same clarity without
 * asking anyone to relearn the common case.
 */
export function label(item: Pick<WorkItem, "kind" | "number">): string {
  return item.kind === "incident" ? `#${item.number}` : `R-${item.number}`;
}

function time(ts: Timestamp | undefined): number {
  return ts ? timestampDate(ts).getTime() : 0;
}

/**
 * When an incident last changed. The server keeps this for us.
 */
export function changedAtIncident(view: IncidentView): number {
  return time(view.incident?.lastModified);
}

/**
 * When a report last changed — as far as a client can tell.
 *
 * `Report` has no `last_modified`: it carries `created` and its journal and
 * nothing else temporal. So this is the newest thing on it, and it follows
 * that **a report's summary edit is invisible here** and will not mark the row
 * unread. Closing that gap means adding `last_modified` to the resource — a
 * proto change, a migration and a server slice (09q, open question 5).
 */
export function changedAtReport(view: ReportView): number {
  const report = view.report;
  if (!report) {
    return 0;
  }
  return report.journalEntries.reduce(
    (newest, entry) => Math.max(newest, time(entry.created)),
    time(report.created),
  );
}

/**
 * Why this incident is mine, or undefined when it is not.
 *
 * `me === 0` classifies NOTHING. A proto3 scalar defaults to 0 and so does
 * `GetAuthStatus.person_id` for an unauthenticated caller, so a zero matching
 * an absent `created_by` would quietly make every unattributed incident
 * everyone's.
 */
export function whyMineIncident(
  view: IncidentView,
  me: number,
): MineReason | undefined {
  const incident = view.incident;
  if (!incident || me === 0) {
    return undefined;
  }
  if (incident.createdBy?.personId === me) {
    return "created";
  }
  if (incident.people.some((p) => p.person?.personId === me)) {
    return "attached";
  }
  if (mentionsMe(incident.journalEntries, me)) {
    return "mentioned";
  }
  return undefined;
}

/** As above, minus "attached" — a report has no `people`. */
export function whyMineReport(
  view: ReportView,
  me: number,
): MineReason | undefined {
  const report = view.report;
  if (!report || me === 0) {
    return undefined;
  }
  if (report.createdBy?.personId === me) {
    return "created";
  }
  if (mentionsMe(report.journalEntries, me)) {
    return "mentioned";
  }
  return undefined;
}

function mentionsMe(entries: readonly JournalEntry[], me: number): boolean {
  return entries.some((entry) =>
    entry.mentions.some((ref) => ref.personId === me),
  );
}

export function toIncidentItem(
  view: IncidentView,
  me: number,
  areaName: (slug: string) => string,
): WorkItem | undefined {
  const incident = view.incident;
  if (!incident) {
    return undefined;
  }
  const why = whyMineIncident(view, me);
  return {
    kind: "incident",
    number: incident.number,
    summary: incident.summary || "(no summary)",
    where: locationOf(
      incident.location?.areaSlug,
      incident.location?.description,
      incident.location?.booth,
      areaName,
    ),
    mine: why !== undefined,
    why: why ?? "created",
    state: incident.state === IncidentState.CLOSED ? "closed" : "open",
    priority: priorityOf(incident.priority),
    private: incident.private,
    changedAt: changedAtIncident(view),
  };
}

export function toReportItem(
  view: ReportView,
  me: number,
): WorkItem | undefined {
  const report = view.report;
  if (!report) {
    return undefined;
  }
  const why = whyMineReport(view, me);
  return {
    kind: "report",
    number: report.number,
    summary: report.summary || "(no summary)",
    mine: why !== undefined,
    why: why ?? "created",
    changedAt: changedAtReport(view),
  };
}

function priorityOf(priority: IncidentPriority): WorkItem["priority"] {
  if (priority === IncidentPriority.HIGH) {
    return "high";
  }
  if (priority === IncidentPriority.LOW) {
    return "low";
  }
  return "normal";
}

function locationOf(
  areaSlug: string | undefined,
  description: string | undefined,
  booth: string | undefined,
  areaName: (slug: string) => string,
): string {
  const parts: string[] = [];
  if (areaSlug) {
    parts.push(areaName(areaSlug));
  }
  if (description) {
    parts.push(description);
  }
  if (booth) {
    parts.push(`Booth ${booth}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No location";
}

/** Newest first — the order every segment reads in. */
export function newestFirst(a: WorkItem, b: WorkItem): number {
  return b.changedAt - a.changedAt;
}
