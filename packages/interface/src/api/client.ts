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
