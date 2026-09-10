// SPDX-License-Identifier: Apache-2.0

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
