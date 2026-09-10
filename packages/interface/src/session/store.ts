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

import type { RefreshTokenStore } from "@/session/types";

// The web refresh-token store (plan 09i E4, 09l F9): a no-op. On web the
// refresh token is the HttpOnly `refresh_token` cookie — set by Login, sent by
// the browser on RefreshToken, cleared by Logout — and JavaScript never sees
// it. Metro picks store.native.ts on iOS/Android; this file is what web, tsc
// and Jest resolve for `@/session/store`.

export const refreshTokenStore: RefreshTokenStore = {
  load: () => Promise.resolve(undefined),
  save: () => Promise.resolve(),
  clear: () => Promise.resolve(),
};
