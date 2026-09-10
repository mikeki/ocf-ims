// SPDX-License-Identifier: Apache-2.0

import type { Event } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/event_pb";

// Which event is "the current fair" (plan 09n T4). Event ids do not track
// years — a later-seeded older year can get a higher id — so a numeric name
// always outranks a higher id; only when no event has a numeric name does the
// highest id decide. Ported from the templ client's `newestEvent`
// (web/typescript/ims.ts).

function numericName(event: Event): number | undefined {
  const name = event.name?.trim();
  if (!name || !/^\d+$/.test(name)) {
    return undefined;
  }
  const n = Number.parseInt(name, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function newestEvent(events: readonly Event[]): Event | undefined {
  let best: Event | undefined;
  let bestNumeric = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const numeric = numericName(event);
    if (numeric === undefined) {
      continue;
    }
    if (best === undefined || numeric > bestNumeric) {
      best = event;
      bestNumeric = numeric;
    }
  }
  if (best) {
    return best;
  }
  return events.reduce<Event | undefined>(
    (a, b) => (a === undefined || b.id > a.id ? b : a),
    undefined,
  );
}

/** Numeric-named events first (descending), then the rest by id (descending). */
export function sortEventsNewestFirst(events: readonly Event[]): Event[] {
  return [...events].sort((a, b) => {
    const an = numericName(a);
    const bn = numericName(b);
    if (an !== undefined && bn !== undefined) {
      return bn - an;
    }
    if (an !== undefined) {
      return -1;
    }
    if (bn !== undefined) {
      return 1;
    }
    return b.id - a.id;
  });
}

/** The remembered event when it is still in the list, else the newest. */
export function defaultEvent(
  events: readonly Event[],
  rememberedId: number | undefined,
): Event | undefined {
  if (rememberedId !== undefined) {
    const remembered = events.find((e) => e.id === rememberedId);
    if (remembered) {
      return remembered;
    }
  }
  return newestEvent(events);
}
