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
