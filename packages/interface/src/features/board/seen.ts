// SPDX-License-Identifier: Apache-2.0

import type { AsyncStorageLike } from "@/api/persist";
import type { WorkItem } from "@/features/board/work";

// The unread watermark (plan 09q, slice 3b.1): what THIS DEVICE has opened, as
// pure functions over an AsyncStorageLike (like features/events/selected.ts).
// One key per event holding a map, not a key per row. Not cleared on sign-out;
// it holds numbers and timestamps only.

export type SeenMarks = Readonly<Record<string, number>>;

export function seenKey(eventId: number): string {
  return `ocf-ims/seen/${eventId}`;
}

/** The map key for one row. Kinds share a number space, so the kind is in it. */
export function markOf(item: Pick<WorkItem, "kind" | "number">): string {
  return `${item.kind === "incident" ? "i" : "r"}${item.number}`;
}

export async function loadSeen(
  storage: AsyncStorageLike,
  eventId: number,
): Promise<SeenMarks> {
  const raw = await storage.getItem(seenKey(eventId));
  if (raw === null) {
    return {};
  }
  return parseSeen(raw);
}

/** Tolerates junk: an unreadable watermark shows too much, never too little. */
export function parseSeen(raw: string): SeenMarks {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const marks: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      marks[key] = value;
    }
  }
  return marks;
}

export async function saveSeen(
  storage: AsyncStorageLike,
  eventId: number,
  marks: SeenMarks,
): Promise<void> {
  await storage.setItem(seenKey(eventId), JSON.stringify(marks));
}

/**
 * Whether a row changed since this device last opened it. Never opened counts
 * as unread, unless I filed it myself.
 */
export function isUnread(item: WorkItem, marks: SeenMarks): boolean {
  if (!item.mine) {
    return false;
  }
  const mark = marks[markOf(item)];
  if (mark === undefined) {
    return item.why !== "created";
  }
  return item.changedAt > mark;
}

/** The marks after opening a row. Never moves a mark backwards. */
export function withSeen(marks: SeenMarks, item: WorkItem): SeenMarks {
  const key = markOf(item);
  const mark = marks[key];
  if (mark !== undefined && mark >= item.changedAt) {
    return marks;
  }
  return { ...marks, [key]: item.changedAt };
}
