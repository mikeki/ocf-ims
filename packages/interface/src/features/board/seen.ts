// SPDX-License-Identifier: Apache-2.0

import type { AsyncStorageLike } from "@/api/persist";
import type { WorkItem } from "@/features/board/work";

// The unread watermark (plan 09q, slice 3b.1). There is no server-side "read"
// state and none is being added: this is what THIS DEVICE has looked at.
//
// Pure functions over an AsyncStorageLike, following
// features/events/selected.ts — the hook wires the real module, so tests need
// nothing beyond src/test/storage.ts.
//
// One key per event holding a map, not a key per row: a Board with two hundred
// incidents would otherwise be two hundred reads on mount.
//
// NOT cleared on sign-out, same as the remembered event: a shared device at
// the fair keeps what it has seen. It holds numbers and timestamps — nothing
// about the incidents themselves, and nothing that identifies a person.

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

/**
 * Tolerates anything: a half-written value, a key from a future version, a
 * browser that returned junk. A watermark that cannot be read means rows look
 * unread, which is the safe direction to fail — it shows too much, never too
 * little.
 */
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
 * Whether a row has changed since this device last opened it.
 *
 * No mark at all means it has never been opened — unread, UNLESS I am the one
 * who filed it, because I have already seen what I just made.
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

/**
 * The marks after opening a row. Written on OPEN — a row scrolling past is not
 * a read — and never moved backwards, so an older cached `changedAt` arriving
 * after a newer one cannot resurrect a row you have already read.
 */
export function withSeen(marks: SeenMarks, item: WorkItem): SeenMarks {
  const key = markOf(item);
  const mark = marks[key];
  if (mark !== undefined && mark >= item.changedAt) {
    return marks;
  }
  return { ...marks, [key]: item.changedAt };
}
