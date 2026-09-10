// SPDX-License-Identifier: Apache-2.0

import * as SecureStore from "expo-secure-store";
import { createSecureRefreshTokenStore } from "@/session/secureStore";
import type { RefreshTokenStore } from "@/session/types";

// The native refresh-token store (plan 09i E4, 09l F9): expo-secure-store —
// the iOS keychain / Android keystore. Metro resolves this file for
// `@/session/store` on iOS and Android; store.ts is the web no-op. The
// default accessibility (readable while the device is unlocked) is right for a
// token read when the app comes to the foreground.

export const refreshTokenStore: RefreshTokenStore =
  createSecureRefreshTokenStore(SecureStore);
