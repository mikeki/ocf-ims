// SPDX-License-Identifier: Apache-2.0

import {
  isUnread,
  loadSeen,
  markOf,
  parseSeen,
  type SeenMarks,
  saveSeen,
  seenKey,
  withSeen,
} from "@/features/board/seen";
import type { WorkItem } from "@/features/board/work";
import { createMemoryAsyncStorage } from "@/test/storage";

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    kind: "incident",
    number: 214,
    summary: "Lost child reunited with parent",
    mine: true,
    why: "attached",
    changedAt: 1_000,
    ...overrides,
  };
}

describe("isUnread", () => {
  it("is false for something that is not mine, however new", () => {
    expect(isUnread(item({ mine: false, changedAt: 9_999 }), {})).toBe(false);
  });

  // First sight: it arrived for me and I have never opened it.
  it("is true on first sight when someone else put it in front of me", () => {
    expect(isUnread(item({ why: "attached" }), {})).toBe(true);
    expect(isUnread(item({ why: "mentioned" }), {})).toBe(true);
  });

  // I have already seen what I just made.
  it("is false on first sight for something I filed myself", () => {
    expect(isUnread(item({ why: "created" }), {})).toBe(false);
  });

  it("is false once opened, and true again when it changes after that", () => {
    const opened = withSeen({}, item({ changedAt: 1_000 }));
    expect(isUnread(item({ changedAt: 1_000 }), opened)).toBe(false);
    expect(isUnread(item({ changedAt: 1_001 }), opened)).toBe(true);
  });

  // Kinds share a number space: report 214 and incident 214 are different
  // rows, and opening one must not mark the other read.
  it("keeps incident 214 and report 214 apart", () => {
    const marks = withSeen({}, item({ kind: "incident", number: 214 }));
    const report = item({ kind: "report", number: 214, why: "mentioned" });
    expect(isUnread(report, marks)).toBe(true);
    expect(markOf(report)).not.toBe(markOf(item()));
  });
});

describe("withSeen", () => {
  it("never moves a mark backwards", () => {
    const marks = withSeen({}, item({ changedAt: 2_000 }));
    const after = withSeen(marks, item({ changedAt: 1_000 }));
    // A stale cached copy arriving late must not resurrect a read row.
    expect(after).toBe(marks);
    expect(isUnread(item({ changedAt: 2_000 }), after)).toBe(false);
  });

  it("returns the same object when nothing changed", () => {
    const marks = withSeen({}, item());
    expect(withSeen(marks, item())).toBe(marks);
  });
});

describe("parseSeen", () => {
  // A watermark that cannot be read means rows look unread — it shows too
  // much, never too little — so every bad shape has to land on {}.
  it.each([
    ["not json at all", "{"],
    ["a json array", "[1,2,3]"],
    ["a json scalar", '"nope"'],
    ["null", "null"],
  ])("survives %s", (_name, raw) => {
    expect(parseSeen(raw)).toEqual({});
  });

  it("drops entries that are not finite numbers", () => {
    expect(parseSeen('{"i1":123,"i2":"soon","i3":null}')).toEqual({ i1: 123 });
  });
});

describe("storage round trip", () => {
  it("stores one key per event", async () => {
    const storage = createMemoryAsyncStorage();
    const marks: SeenMarks = { i214: 1_000, r38: 2_000 };
    await saveSeen(storage, 1, marks);

    expect([...storage.items.keys()]).toEqual([seenKey(1)]);
    await expect(loadSeen(storage, 1)).resolves.toEqual(marks);
    // A different event has its own marks, not these.
    await expect(loadSeen(storage, 2)).resolves.toEqual({});
  });
});
