// SPDX-License-Identifier: Apache-2.0

import type { AsyncStorageLike } from "@/api/persist";
import type { StateFilter } from "@/features/dispatch/query";

// The dispatch table's remembered state filter (plan 09x criterion 6): pure
// functions over an AsyncStorageLike, like features/events/selected.ts.
// Precedence is URL > stored > "open"; `useDispatchQuery` applies that — this
// module only loads and saves the middle term, and never touches the URL.

export const STATE_PREFERENCE_KEY = "ocf-ims/dispatch/statePreference";

export async function loadStatePreference(
  storage: AsyncStorageLike,
): Promise<StateFilter | undefined> {
  const raw = await storage.getItem(STATE_PREFERENCE_KEY);
  return raw === "open" || raw === "closed" || raw === "all" ? raw : undefined;
}

export async function saveStatePreference(
  storage: AsyncStorageLike,
  state: StateFilter,
): Promise<void> {
  await storage.setItem(STATE_PREFERENCE_KEY, state);
}
