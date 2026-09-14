// SPDX-License-Identifier: Apache-2.0

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { LinkInput } from "@/features/incidents/useEditIncident";

// Pure helpers behind the editor's text controls (plan 09y): the started
// field's strict format (decision 6) and templ's link syntax — `1`, `3,4,5`,
// `2015#2` (another event, by name).

export const STARTED_FORMAT = "YYYY-MM-DD HH:mm";
const STARTED_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local time, in the strict format. */
export function formatStarted(ts: Timestamp | undefined): string {
  if (!ts) {
    return "";
  }
  const d = timestampDate(ts);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function validateStarted(text: string): string | undefined {
  const m = STARTED_RE.exec(text.trim());
  if (!m) {
    return `Use ${STARTED_FORMAT}`;
  }
  const d = parseStartedDate(text);
  return d && !Number.isNaN(d.getTime()) ? undefined : `Use ${STARTED_FORMAT}`;
}

function parseStartedDate(text: string): Date | undefined {
  const m = STARTED_RE.exec(text.trim());
  if (!m) {
    return undefined;
  }
  const [, y, mo, d, h, mi] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    0,
    0,
  );
}

export function parseStarted(text: string): Timestamp | undefined {
  const d = parseStartedDate(text);
  return d && !Number.isNaN(d.getTime()) ? timestampFromDate(d) : undefined;
}

export interface EventName {
  id: number;
  name: string;
}

export type ParsedLinks =
  | { links: LinkInput[]; error?: undefined }
  | { links?: undefined; error: string };

/** templ's link syntax: numbers are this event's; `name#n` is another event's. */
export function parseLinks(
  text: string,
  events: EventName[],
  thisEventId: number,
): ParsedLinks {
  const tokens = text
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return { error: "Type an incident number" };
  }
  const links: LinkInput[] = [];
  for (const token of tokens) {
    if (/^#?\d+$/.test(token)) {
      links.push({
        eventId: thisEventId,
        incidentNumber: Number(token.replace("#", "")),
      });
      continue;
    }
    const m = /^(.+)#(\d+)$/.exec(token);
    if (m) {
      const name = (m[1] ?? "").trim().toLowerCase();
      const event = events.find((e) => e.name.toLowerCase() === name);
      if (!event) {
        return { error: `No event named “${m[1]}”` };
      }
      links.push({ eventId: event.id, incidentNumber: Number(m[2]) });
      continue;
    }
    return { error: `“${token}” isn't a number or event#number` };
  }
  return { links };
}

export function parseNumbers(text: string): number[] | undefined {
  const tokens = text
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.some((t) => !/^\d+$/.test(t))) {
    return undefined;
  }
  return tokens.map(Number);
}
