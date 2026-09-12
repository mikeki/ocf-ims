// SPDX-License-Identifier: Apache-2.0

import {
  insertMention,
  mentionedIds,
  mentionQuery,
  tokenFor,
} from "@/features/compose/mentions";

describe("mentionQuery", () => {
  it("opens on an @ at the start of the text", () => {
    expect(mentionQuery("@Ma", 3)).toEqual({ start: 0, query: "Ma" });
  });

  it("opens on an @ after whitespace", () => {
    expect(mentionQuery("call @De", 8)).toEqual({ start: 5, query: "De" });
  });

  it("does not open on an @ mid-word (an email)", () => {
    expect(mentionQuery("dee@example.org", 15)).toBeUndefined();
  });

  it("closes once whitespace follows the query", () => {
    expect(mentionQuery("@Dee can you", 12)).toBeUndefined();
  });

  it("is a function of the text up to the caret, not the whole text", () => {
    expect(mentionQuery("@De and more", 3)).toEqual({ start: 0, query: "De" });
  });
});

describe("tokenFor", () => {
  it("is the handle, else the name — one word", () => {
    expect(tokenFor({ handle: "Dee", name: "Dee Alvarado" })).toBe("@Dee");
    expect(tokenFor({ handle: "", name: "Jules Bertrand" })).toBe(
      "@Jules Bertrand",
    );
  });
});

describe("insertMention", () => {
  it("replaces the trigger with the token and a space, caret after", () => {
    expect(insertMention("hi @Ma there", 6, "@Marisol")).toEqual({
      text: "hi @Marisol  there",
      caret: 12,
    });
  });

  it("leaves the text alone when the caret is not in a trigger", () => {
    expect(insertMention("hi there", 8, "@Marisol")).toEqual({
      text: "hi there",
      caret: 8,
    });
  });
});

describe("mentionedIds", () => {
  const picked = [
    { personId: 3, token: "@Marisol" },
    { personId: 2, token: "@Ray" },
    { personId: 3, token: "@Marisol" },
  ];

  it("sends only the mentions whose token is still in the text, once each", () => {
    expect(
      mentionedIds("@Marisol can you take this? @Marisol", picked),
    ).toEqual([3]);
  });

  it("drops a mention whose word was deleted", () => {
    expect(mentionedIds("can you take this?", picked)).toEqual([]);
  });
});
