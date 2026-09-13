// SPDX-License-Identifier: Apache-2.0

import type { AsyncStorageLike } from "@/api/persist";

// Unsent composer text, per event and per target (plan 09r § Drafts): pure
// functions over an AsyncStorageLike, like seen.ts. One key holds every
// draft on the device so sign-out can clear them all — a draft is incident
// content, and goes the way the persisted query cache does.

export const DRAFTS_KEY = "ocf-ims/drafts";

/**
 * `"new"` for the filing form, an incident number for its composer,
 * `"report-new"` for the report form and `report-<n>` for a report's composer (09t).
 */
export type DraftTarget = "new" | "report-new" | number | `report-${number}`;

export interface Draft {
  summary?: string;
  text: string;
  /** The report form's "on behalf of" pick (09t): a person id and its label. */
  onBehalfOf?: { personId: number; label: string };
}

export type Drafts = Readonly<Record<string, Draft>>;

export function draftKey(eventId: number, target: DraftTarget): string {
  return `${eventId}/${target}`;
}

export function isEmptyDraft(draft: Draft | undefined): boolean {
  return !draft || (!draft.summary?.trim() && !draft.text.trim());
}

export async function loadDrafts(storage: AsyncStorageLike): Promise<Drafts> {
  const raw = await storage.getItem(DRAFTS_KEY);
  return raw === null ? {} : parseDrafts(raw);
}

/** Tolerates junk: an unreadable store loses drafts, never crashes a screen. */
export function parseDrafts(raw: string): Drafts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const drafts: Record<string, Draft> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const { summary, text, onBehalfOf } = value as Partial<Draft>;
    if (typeof text !== "string") {
      continue;
    }
    const pick =
      typeof onBehalfOf === "object" &&
      onBehalfOf !== null &&
      typeof onBehalfOf.personId === "number" &&
      typeof onBehalfOf.label === "string"
        ? { personId: onBehalfOf.personId, label: onBehalfOf.label }
        : undefined;
    drafts[key] = {
      text,
      ...(typeof summary === "string" ? { summary } : {}),
      ...(pick ? { onBehalfOf: pick } : {}),
    };
  }
  return drafts;
}

export async function loadDraft(
  storage: AsyncStorageLike,
  eventId: number,
  target: DraftTarget,
): Promise<Draft | undefined> {
  const drafts = await loadDrafts(storage);
  return drafts[draftKey(eventId, target)];
}

/** An empty draft is removed rather than stored. */
export async function saveDraft(
  storage: AsyncStorageLike,
  eventId: number,
  target: DraftTarget,
  draft: Draft,
): Promise<void> {
  const drafts = { ...(await loadDrafts(storage)) };
  const key = draftKey(eventId, target);
  if (isEmptyDraft(draft)) {
    delete drafts[key];
  } else {
    drafts[key] = draft;
  }
  await storage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

export async function clearDraft(
  storage: AsyncStorageLike,
  eventId: number,
  target: DraftTarget,
): Promise<void> {
  const drafts = { ...(await loadDrafts(storage)) };
  delete drafts[draftKey(eventId, target)];
  await storage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

/** Sign-out: every draft on the device. */
export async function clearDrafts(storage: AsyncStorageLike): Promise<void> {
  await storage.removeItem(DRAFTS_KEY);
}
