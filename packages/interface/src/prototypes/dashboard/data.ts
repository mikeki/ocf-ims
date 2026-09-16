// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  type MetricCount,
  MetricCountSchema,
  type MetricDay,
  MetricDaySchema,
  MetricIncidentRefSchema,
  type Metrics,
  MetricsSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/metrics_pb";

// The 3c.5 round's fixture (docs/plans/09ab-dashboard-design.md § The
// prototype round, the fixture paragraph): one event with ~180 incidents
// over 8 days, and one empty event. Built with `create(MetricsSchema, …)`
// rather than JSON, so the shapes stay exactly what the wire promises.

export const FAIR_EVENT = { id: 1, name: "Fair 2026" };
export const EMPTY_EVENT = { id: 2, name: "Empty event" };

const TOTAL = 180;
const OPEN = 31;
const CLOSED = 149; // OPEN + CLOSED === TOTAL, as by_state/by_priority must.

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function counts(
  entries: [label: string, count: number][],
  keyPrefix: string,
): MetricCount[] {
  return entries.map(([label, count]) =>
    create(MetricCountSchema, {
      key: `${keyPrefix}:${slug(label)}`,
      label,
      count: BigInt(count),
    }),
  );
}

// --- by_day: 8 days ending today, the busiest (~40) four days in. ---

const DAY_COUNTS = [15, 22, 18, 40, 28, 24, 20, 13]; // sums to TOTAL (180)

function buildDays(): MetricDay[] {
  const today = new Date();
  return DAY_COUNTS.map((count, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (DAY_COUNTS.length - 1 - i));
    return create(MetricDaySchema, {
      date: d.toISOString().slice(0, 10),
      count: BigInt(count),
    });
  });
}

// --- by_area: ~40 areas, partitioning the incidents (sums to TOTAL), a
// long top-heavy tail so the round can show the top-10-plus-N-more fold. ---

const AREA_NAMES = [
  "Main Stage — Back of House",
  "Community Village",
  "Chela Mela Meadow",
  "Front Porch",
  "Xavier's Palace",
  "Dance Pavilion",
  "Ritual Site",
  "Youth Program",
  "Family Camp",
  "Energy Park",
  "Craft Bazaar",
  "Center Camp",
  "Path to Alice's",
  "Blue Moon",
  "Cascadia",
  "Fiddlers Grove",
  "Barter Faire",
  "Sanctuary",
  "Ticket Booth — Main Gate",
  "Parking — North Lot",
  "Parking — South Lot",
  "Kids Camp",
  "Teen Crew",
  "Volunteer Village",
  "Medical Tent — Main",
  "Medical Tent — Annex",
  "Kitchen — Community",
  "Recycling Center",
  "Water Station — East",
  "Water Station — West",
  "Shower Facility",
  "Camping Loop A",
  "Camping Loop B",
  "Camping Loop C",
  "Camping Loop D",
  "Main Gate Road",
  "Fire Circle",
  "Story Grove",
  "Grandstand Meadow",
  "Overflow Parking",
];

function buildAreas(): MetricCount[] {
  // A top-heavy split (rank i gets weight 1/(i+1.5)) rounded to whole
  // incidents, the rounding drift folded into the busiest area — a partition
  // of TOTAL, as by_area must be (§ What is already true on the wire).
  const weights = AREA_NAMES.map((_, i) => 1 / (i + 1.5));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) =>
    Math.max(1, Math.round((w / weightSum) * TOTAL)),
  );
  const drift = TOTAL - raw.reduce((a, b) => a + b, 0);
  raw[0] = (raw[0] ?? 0) + drift;
  return AREA_NAMES.map((label, i) =>
    create(MetricCountSchema, {
      key: `area:${slug(label)}`,
      label,
      count: BigInt(raw[i] ?? 1),
    }),
  );
}

// --- by_type: ~18 types; by_category: 6 incl. "Ungrouped". Both may exceed
// TOTAL (an incident can carry several), so these are their own tallies. ---

const TYPE_COUNTS: [string, number][] = [
  ["Medical — Minor", 45],
  ["Medical — Transport", 38],
  ["Missing person", 30],
  ["Lost child", 26],
  ["Welfare check", 22],
  ["Noise complaint", 18],
  ["Vehicle issue", 16],
  ["Weather — Wind", 14],
  ["Weather — Heat", 12],
  ["Security — Theft", 10],
  ["Security — Assault", 9],
  ["Alcohol / drug", 8],
  ["Animal", 7],
  ["Environmental hazard", 6],
  ["Traffic", 5],
  ["Sound / stage", 4],
  ["Structure fire", 3],
  ["Other", 2],
];

const CATEGORY_COUNTS: [string, number][] = [
  ["Medical", 62],
  ["Security", 48],
  ["Weather", 20],
  ["Structures", 15],
  ["Logistics", 10],
  ["Ungrouped", 25],
];

const PRIORITY_COUNTS: [string, number][] = [
  ["High", 34],
  ["Normal", 96],
  ["Low", 50],
]; // sums to TOTAL, as by_priority must.

const STATE_COUNTS: [string, number][] = [
  ["Open", OPEN],
  ["Closed", CLOSED],
];

const ROLE_COUNTS: [string, number][] = [
  // Ladder order (§ The forms: by_role is "not sorted"), not by count.
  ["Writer", 6],
  ["Crew leader", 4],
  ["Reporter", 31],
  ["Volunteer", 12],
  ["Public", 3],
];

const FOLLOW_UP_SUMMARIES: [number, string][] = [
  [142, "Missing camper reported near Chela Mela Meadow, last seen 22:00"],
  [138, "Structure damage from wind, awaiting inspection"],
  [129, "Welfare check requested for camper at Camping Loop C"],
  [121, "Theft report — bicycle, Craft Bazaar; description on file"],
  [117, "Noise complaint escalation, repeat address at Blue Moon"],
  [104, "Medical transport follow-up — discharge paperwork pending"],
  [96, "Lost child reunited; guardian contact still needs confirmation"],
  [83, "Vehicle blocking Main Gate Road, owner being paged"],
  [71, "Animal (loose dog) reported near Family Camp, not yet located"],
];

function buildFollowUps() {
  return FOLLOW_UP_SUMMARIES.map(([incidentNumber, summary]) =>
    create(MetricIncidentRefSchema, { incidentNumber, summary }),
  );
}

const AVG_TIME_TO_CLOSE_SECONDS = 8040; // 2 h 14 m, over CLOSED (149).

/** Fair 2026: the full fixture (§ The prototype round's fixture paragraph). */
export function buildFairMetrics(): Metrics {
  return create(MetricsSchema, {
    event: FAIR_EVENT.name,
    eventId: FAIR_EVENT.id,
    total: BigInt(TOTAL),
    open: BigInt(OPEN),
    closed: BigInt(CLOSED),
    byState: counts(STATE_COUNTS, "state"),
    byPriority: counts(PRIORITY_COUNTS, "priority"),
    byCategory: counts(CATEGORY_COUNTS, "category"),
    byType: counts(TYPE_COUNTS, "type"),
    byRole: counts(ROLE_COUNTS, "role"),
    byArea: buildAreas(),
    byDay: buildDays(),
    openFollowUps: buildFollowUps(),
    avgTimeToCloseSeconds: AVG_TIME_TO_CLOSE_SECONDS,
    closedCount: BigInt(CLOSED),
    generatedAt: timestampFromDate(new Date()),
  });
}

/** The empty event: every tile "—" or 0, no avg, no bars, no follow-ups. */
export function buildEmptyMetrics(): Metrics {
  return create(MetricsSchema, {
    event: EMPTY_EVENT.name,
    eventId: EMPTY_EVENT.id,
    total: 0n,
    open: 0n,
    closed: 0n,
    byState: [],
    byPriority: [],
    byCategory: [],
    byType: [],
    byRole: [],
    byArea: [],
    byDay: [],
    openFollowUps: [],
    avgTimeToCloseSeconds: undefined,
    closedCount: 0n,
    generatedAt: timestampFromDate(new Date()),
  });
}

/**
 * "A refresh that changes three numbers" (the fixture paragraph): a copy of
 * `base` with open +1, one area +1 and today's by_day +1 — deliberately NOT
 * also bumping total/closed, so exactly those three fields (and nothing
 * else) land in `useMetrics`' `changedKeys` for the round to show the mark
 * on. Always derived from the fixed base, so toggling the band's switch
 * twice shows the same bumped numbers rather than drifting further.
 */
export function changed(base: Metrics): Metrics {
  const byArea = base.byArea.map((a, i) =>
    i === 0 ? create(MetricCountSchema, { ...a, count: a.count + 1n }) : a,
  );
  const byDay = base.byDay.map((d, i) =>
    i === base.byDay.length - 1
      ? create(MetricDaySchema, { ...d, count: d.count + 1n })
      : d,
  );
  return create(MetricsSchema, {
    ...base,
    open: base.open + 1n,
    byArea,
    byDay,
    generatedAt: timestampFromDate(new Date()),
  });
}
