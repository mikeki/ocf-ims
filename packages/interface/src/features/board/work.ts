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

// The Board's domain logic (plan 09q, slice 3b.1): whose an item is, when it
// last changed, what it is called. Pure; seen.ts decides what is unread.

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
  /** Someone asked me for a report on this incident and I have not filed one (09t). */
  owesReport?: boolean;
  /** The comparison key, and the sort key. See changedAt* below. */
  changedAt: number;
}

export type MineReason = "created" | "owed" | "attached" | "mentioned";

export const whyLabel: Readonly<Record<MineReason, string>> = {
  created: "You filed",
  owed: "Report requested",
  attached: "You're on it",
  mentioned: "Mentions you",
};

/**
 * `#214` for an incident, `R-38` for a report: the two share a number space,
 * and only the rarer one carries the mark (09q decision 1).
 */
export function label(item: Pick<WorkItem, "kind" | "number">): string {
  return item.kind === "incident" ? `#${item.number}` : `R-${item.number}`;
}

function time(ts: Timestamp | undefined): number {
  return ts ? timestampDate(ts).getTime() : 0;
}

/** When an incident last changed. */
export function changedAtIncident(view: IncidentView): number {
  return time(view.incident?.lastModified);
}

/**
 * When a report last changed, as far as a client can tell: `Report` has no
 * `last_modified`, so a summary edit is invisible here (09q open question 5).
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
 * Why this incident is mine, or undefined. `me === 0` classifies nothing: a
 * proto3 scalar defaults to 0, and so would an absent `created_by`.
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
  if (owesReport(view, me)) {
    return "owed";
  }
  if (incident.people.some((p) => p.person?.personId === me)) {
    return "attached";
  }
  if (mentionsMe(incident.journalEntries, me)) {
    return "mentioned";
  }
  return undefined;
}

/** My involvement row carries an ask and no delivered report (09t). */
export function owesReport(view: IncidentView, me: number): boolean {
  if (me === 0) {
    return false;
  }
  const mine = view.incident?.people.find((p) => p.person?.personId === me);
  return (
    mine !== undefined &&
    mine.reportRequested !== undefined &&
    mine.reportNumber === undefined
  );
}

/** As above, minus "attached": a report has no `people`. */
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
    owesReport: owesReport(view, me),
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
