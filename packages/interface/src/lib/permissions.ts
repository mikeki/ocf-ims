// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import type {
  AccessForEvent,
  GetAuthStatusResponse,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import { AccessForEventSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";

// Permission helpers (plan 09i §5): permissions come from GetAuthStatus and
// gate UI affordances ONLY — the server stays authoritative, and the client
// never derives a permission from a role name.

/**
 * The caller's access to one event, from a GetAuthStatus response that asked
 * for it (`event_id`). Absent — not requested, or the server answered its
 * all-false entry because the event does not exist or the caller has no access
 * — returns an all-false AccessForEvent, exactly as the server does, so a
 * screen never distinguishes "no such event" from "no access".
 */
export function eventAccess(
  auth: Pick<GetAuthStatusResponse, "eventAccess"> | undefined,
  eventId: number,
): AccessForEvent {
  return auth?.eventAccess[eventId] ?? create(AccessForEventSchema);
}

export function isAdmin(
  auth: Pick<GetAuthStatusResponse, "authenticated" | "admin"> | undefined,
): boolean {
  return auth?.authenticated === true && auth.admin;
}
