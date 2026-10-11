// SPDX-License-Identifier: Apache-2.0

import type { Tone } from "@/design/tokens";

// Small formatting helpers shared by the three variants
// (docs/plans/09ab-dashboard-design.md § The forms).

/** "—" when nothing has closed yet, else "2 h 14 m" (no leading zero). */
export function avgCloseValue(seconds: number | undefined): string {
  if (seconds === undefined) {
    return "—";
  }
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} m` : `${minutes} m`;
}

export function avgCloseCaption(
  seconds: number | undefined,
  closedCount: bigint,
): string {
  return seconds === undefined
    ? "No incidents closed yet"
    : `of ${closedCount}`;
}

/**
 * The priority tones (DESIGN.md's colour language, mirrored by
 * `lib/format.ts#priorityLabel`): High is the only one that carries colour;
 * Normal and Low both read as neutral.
 */
export function priorityTone(key: string): Tone {
  return key.includes("high") ? "danger" : "neutral";
}

export function toCount(count: bigint): number {
  return Number(count);
}
