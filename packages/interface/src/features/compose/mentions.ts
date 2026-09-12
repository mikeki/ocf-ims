// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";

// `@` mentions in a composer (plan 09r § Mentions). Pure; the composer owns
// the caret and calls these.

export interface Picked {
  personId: number;
  token: string;
}

/** The server answers nothing below this many characters, so the client asks nothing. */
export const MENTION_QUERY_MIN = 2;

/**
 * The `@word` the caret is inside: an `@` at the start of the text or after
 * whitespace, with no whitespace between it and the caret. An `@` mid-word
 * (an email) is not a trigger.
 */
export function mentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | undefined {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0) {
    return undefined;
  }
  if (at > 0 && !/\s/.test(upto.charAt(at - 1))) {
    return undefined;
  }
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) {
    return undefined;
  }
  return { start: at, query };
}

/** One bare word: the handle, else the name — never the "Fair (Legal)" label. */
export function tokenFor(p: Pick<Person, "handle" | "name">): string {
  return `@${p.handle?.trim() || p.name?.trim() || ""}`;
}

/** Inserts the token (plus a space) over the trigger; returns the text and the caret after it. */
export function insertMention(
  text: string,
  caret: number,
  token: string,
): { text: string; caret: number } {
  const trigger = mentionQuery(text, caret);
  if (!trigger) {
    return { text, caret };
  }
  const before = text.slice(0, trigger.start);
  const after = text.slice(caret);
  const next = `${before}${token} ${after}`;
  return { text: next, caret: before.length + token.length + 1 };
}

/** Only the mentions whose token is still in the text are sent. */
export function mentionedIds(
  text: string,
  picked: readonly Picked[],
): number[] {
  const ids = new Set<number>();
  for (const m of picked) {
    if (text.includes(m.token)) {
      ids.add(m.personId);
    }
  }
  return [...ids];
}
