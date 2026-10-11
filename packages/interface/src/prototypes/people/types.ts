// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { RefObject } from "react";
import type { TextInput } from "react-native";
import type { useRoster } from "@/prototypes/people/useRoster";

// Shared types for the 3c.4 roster round (docs/plans/09aa-roster-design.md
// § The prototype round). One file so the harness, the table and the other
// two variants agree on the same shapes without a barrel file.

/**
 * The three viewers the round's harness switches between (§ The prototype
 * round): admin (every rung, contact fields on the card), inviter (a crew
 * leader — invite_reporters, capped at Reporter/Volunteer/Public, no writer
 * or crew-leader row gets a menu, no contact fields), writer-inviter (a
 * writer who can also invite reporters — same ceiling as inviter, no crews
 * led). `data.ts#identityFor` is the fixture identity each maps to.
 */
export type Viewer = "admin" | "inviter" | "writerInviter";

/**
 * The url-backed query state and its actions every variant needs for its own
 * keyboard map, search box and selection — an addition beyond the brief's
 * literal `RosterPaneProps` shape (recorded in the round's report): `people`
 * /`viewer`/`roster`/`onOpen`/`search` alone left no way for a variant to
 * change the search text, move the selection, close the drawer or reach `n`
 * (Add person). `?` (help) is local state on the variant, as it was on
 * dispatch's own table. Built by `usePeopleQuery` (Harness/Stage), read by
 * the active variant.
 */
export interface PeopleQueryControls {
  selectedId?: number;
  openedId?: number;
  onSelect(personId: number | undefined): void;
  onSearchChange(text: string): void;
  onClose(): void;
  onAddPerson(): void;
  searchRef: RefObject<TextInput | null>;
}

/**
 * The props every roster variant (Table / Ladder / Directory) renders from
 * — the brief's five, plus `query` (this file's own note, above).
 */
export interface RosterPaneProps {
  people: Person[];
  viewer: Viewer;
  roster: ReturnType<typeof useRoster>;
  onOpen: (personId: number) => void;
  search: string;
  query: PeopleQueryControls;
}
