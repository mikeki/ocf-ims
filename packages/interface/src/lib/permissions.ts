//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

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
