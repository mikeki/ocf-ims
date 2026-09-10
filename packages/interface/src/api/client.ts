// SPDX-License-Identifier: Apache-2.0

import type { Client, Transport } from "@connectrpc/connect";
import { createClient } from "@connectrpc/connect";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";

// The promise-style ImsService client. Screens do not use it directly — they
// use connect-query hooks (09i §5) — it is for the session layer (Login,
// RefreshToken, GetAuthStatus, Logout) and for tests.

export type ImsClient = Client<typeof ImsService>;

export function createImsClient(transport: Transport): ImsClient {
  return createClient(ImsService, transport);
}
