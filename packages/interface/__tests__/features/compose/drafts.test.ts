// SPDX-License-Identifier: Apache-2.0

import {
  clearDraft,
  clearDrafts,
  DRAFTS_KEY,
  loadDraft,
  parseDrafts,
  saveDraft,
} from "@/features/compose/drafts";
import { createMemoryAsyncStorage } from "@/test/storage";

describe("drafts", () => {
  it("saves and restores per event and per target", async () => {
    const storage = createMemoryAsyncStorage();
    await saveDraft(storage, 1, "new", { summary: "Fence down", text: "" });
    await saveDraft(storage, 1, 214, { text: "On my way" });
    await saveDraft(storage, 2, 214, { text: "Other event" });
    expect(await loadDraft(storage, 1, "new")).toEqual({
      summary: "Fence down",
      text: "",
    });
    expect(await loadDraft(storage, 1, 214)).toEqual({ text: "On my way" });
    expect(await loadDraft(storage, 2, 214)).toEqual({ text: "Other event" });
    expect(await loadDraft(storage, 1, 209)).toBeUndefined();
  });

  it("removes rather than stores an empty draft", async () => {
    const storage = createMemoryAsyncStorage();
    await saveDraft(storage, 1, 214, { text: "something" });
    await saveDraft(storage, 1, 214, { text: "   " });
    expect(await loadDraft(storage, 1, 214)).toBeUndefined();
  });

  it("clears one target, and every draft on sign-out", async () => {
    const storage = createMemoryAsyncStorage();
    await saveDraft(storage, 1, "new", { summary: "a", text: "" });
    await saveDraft(storage, 1, 214, { text: "b" });
    await clearDraft(storage, 1, 214);
    expect(await loadDraft(storage, 1, 214)).toBeUndefined();
    expect(await loadDraft(storage, 1, "new")).toBeDefined();
    await clearDrafts(storage);
    expect(storage.items.has(DRAFTS_KEY)).toBe(false);
    expect(await loadDraft(storage, 1, "new")).toBeUndefined();
  });

  it("tolerates junk in storage", () => {
    expect(parseDrafts("not json")).toEqual({});
    expect(parseDrafts("[1,2]")).toEqual({});
    expect(
      parseDrafts(
        JSON.stringify({
          "1/new": { summary: 4, text: "ok" },
          "1/2": { text: 7 },
          "1/3": "nope",
        }),
      ),
    ).toEqual({ "1/new": { text: "ok" } });
  });
});
