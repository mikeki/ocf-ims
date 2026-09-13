// SPDX-License-Identifier: Apache-2.0

import {
  type Notification,
  NotificationType,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/notification_pb";

// What an alert says and where it goes (plan 09u). Pure: the wording is the
// templ client's (web/typescript/ims.ts notificationText), and the deep link
// is resolved from the event NAME the server speaks to the id this client
// routes by. A push carries the templ app's URL in `data.url`; the same
// resolver reads it, so one tap on either surface lands on one screen.

export interface EventRef {
  id: number;
  name?: string;
}

export function alertText(n: Notification): string {
  const who = n.actor || "Someone";
  switch (n.type) {
    case NotificationType.MENTIONED:
      return n.reportNumber !== undefined
        ? `${who} mentioned you in a report`
        : `${who} mentioned you`;
    case NotificationType.ADDED_TO_INCIDENT:
      return `${who} added you to an incident`;
    case NotificationType.REPORT_REQUESTED:
      return `${who} asked for your report on an incident`;
    default:
      return `${who} notified you`;
  }
}

/** The second line: the record the alert is about, in the Board's notation. */
export function alertSubject(n: Notification): string | undefined {
  if (n.reportNumber !== undefined) {
    return `R-${n.reportNumber}${n.reportSummary ? ` ${n.reportSummary}` : ""}`;
  }
  if (n.incidentNumber !== undefined) {
    return `#${n.incidentNumber}${n.incidentSummary ? ` ${n.incidentSummary}` : ""}`;
  }
  return undefined;
}

export function alertHref(
  n: Notification,
  events: readonly EventRef[],
): string | undefined {
  const event = events.find((e) => e.name === n.event);
  if (!event) {
    return undefined;
  }
  if (
    n.type === NotificationType.REPORT_REQUESTED &&
    n.incidentNumber !== undefined
  ) {
    return `/events/${event.id}/reports/new?incident=${n.incidentNumber}`;
  }
  if (n.reportNumber !== undefined) {
    return `/events/${event.id}/reports/${n.reportNumber}`;
  }
  if (n.incidentNumber !== undefined) {
    return `/events/${event.id}/incidents/${n.incidentNumber}`;
  }
  return undefined;
}

const PUSH_URL =
  /^\/ims\/app\/events\/([^/?#]+)\/(incidents|reports)\/(\d+|new)(?:\?incident=(\d+))?$/;

/** The templ app URL a push carries → this client's href; undefined for anything else. */
export function pushLinkHref(
  url: string,
  events: readonly EventRef[],
): string | undefined {
  const match = PUSH_URL.exec(url);
  if (!match) {
    return undefined;
  }
  const [, rawName, kind, number, incident] = match;
  let name: string;
  try {
    name = decodeURIComponent(rawName ?? "");
  } catch {
    return undefined;
  }
  const event = events.find((e) => e.name === name);
  if (!event) {
    return undefined;
  }
  if (number === "new") {
    return kind === "reports" && incident
      ? `/events/${event.id}/reports/new?incident=${incident}`
      : undefined;
  }
  return `/events/${event.id}/${kind}/${number}`;
}
