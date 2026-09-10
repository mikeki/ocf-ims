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
import {
  AccessForEventSchema,
  GetAuthStatusResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import { eventAccess, isAdmin } from "@/lib/permissions";

describe("eventAccess", () => {
  const auth = create(GetAuthStatusResponseSchema, {
    authenticated: true,
    eventAccess: {
      3: {
        eventId: 3,
        readIncidents: true,
        writeIncidents: true,
        readAreas: true,
      },
    },
  });

  it("returns the entry for a requested event", () => {
    const access = eventAccess(auth, 3);
    expect(access.readIncidents).toBe(true);
    expect(access.writeIncidents).toBe(true);
    expect(access.writeReports).toBe(false);
  });

  it("returns the server's all-false shape for any other event, or no status", () => {
    const missing = eventAccess(auth, 4);
    expect(missing).toEqual(create(AccessForEventSchema));
    expect(missing.readIncidents).toBe(false);
    expect(eventAccess(undefined, 3).readIncidents).toBe(false);
  });
});

describe("isAdmin", () => {
  it("requires an authenticated admin", () => {
    expect(
      isAdmin(
        create(GetAuthStatusResponseSchema, {
          authenticated: true,
          admin: true,
        }),
      ),
    ).toBe(true);
    expect(
      isAdmin(create(GetAuthStatusResponseSchema, { authenticated: true })),
    ).toBe(false);
    expect(isAdmin(create(GetAuthStatusResponseSchema, { admin: true }))).toBe(
      false,
    );
    expect(isAdmin(undefined)).toBe(false);
  });
});
