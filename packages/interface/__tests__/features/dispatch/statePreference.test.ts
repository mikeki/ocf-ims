// SPDX-License-Identifier: Apache-2.0

import {
  loadStatePreference,
  STATE_PREFERENCE_KEY,
  saveStatePreference,
} from "@/features/dispatch/statePreference";
import { createMemoryAsyncStorage } from "@/test/storage";

// The remembered state filter (plan 09x criterion 6): pure load/save, and
// the URL > stored > "open" precedence lives in `parseQuery`'s
// `fallbackState` parameter (covered in query.test.ts), not here.

describe("statePreference", () => {
  it("answers undefined when nothing is stored", async () => {
    const storage = createMemoryAsyncStorage();
    expect(await loadStatePreference(storage)).toBeUndefined();
  });

  it("round-trips a saved value", async () => {
    const storage = createMemoryAsyncStorage();
    await saveStatePreference(storage, "closed");
    expect(await loadStatePreference(storage)).toBe("closed");
    expect(storage.items.get(STATE_PREFERENCE_KEY)).toBe("closed");
  });

  it("ignores an unreadable value rather than throwing", async () => {
    const storage = createMemoryAsyncStorage();
    storage.items.set(STATE_PREFERENCE_KEY, "sideways");
    expect(await loadStatePreference(storage)).toBeUndefined();
  });

  it("the precedence — URL beats stored, stored beats the open default — is parseQuery's fallback", async () => {
    // See query.test.ts's "uses the fallback state only when the URL carries
    // none": parseQuery({}, "closed").state === "closed", and an explicit
    // URL state always wins regardless of what is stored.
    const storage = createMemoryAsyncStorage();
    await saveStatePreference(storage, "all");
    const stored = await loadStatePreference(storage);
    expect(stored).toBe("all");
  });
});
