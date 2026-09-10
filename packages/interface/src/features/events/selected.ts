// SPDX-License-Identifier: Apache-2.0

import type { AsyncStorageLike } from "@/api/persist";

// The remembered "last opened" event (plan 09n T4). Nothing sensitive — just
// an id — and NOT cleared on sign-out: a device at the fair keeps its event
// across sign-outs. Pure functions over an AsyncStorageLike so they need no
// mocking beyond src/test/storage.ts; the hook (features/events/hooks.ts)
// wires the real AsyncStorage module.

export const SELECTED_EVENT_KEY = "ocf-ims/selectedEventId";

export async function loadSelectedEventId(
  storage: AsyncStorageLike,
): Promise<number | undefined> {
  const raw = await storage.getItem(SELECTED_EVENT_KEY);
  if (raw === null) {
    return undefined;
  }
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

export async function saveSelectedEventId(
  storage: AsyncStorageLike,
  id: number,
): Promise<void> {
  await storage.setItem(SELECTED_EVENT_KEY, String(id));
}
