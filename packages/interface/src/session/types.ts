// SPDX-License-Identifier: Apache-2.0

import type { GetAuthStatusResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import type { AppError } from "@/api/errors";

// The session's contracts (plan 09l F5–F9). Kept in a file of their own so the
// platform-split store files can import the interface without importing each
// other (Metro would resolve `./store` to the current platform's file).

/**
 * Where the refresh token lives between launches. Native keeps it in
 * expo-secure-store; on web it is the HttpOnly cookie the browser holds, so the
 * web store is a no-op and `load` answers undefined.
 */
export interface RefreshTokenStore {
  load(): Promise<string | undefined>;
  save(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** Which session mode the client is in (09i E4): body-carried refresh token, or the cookie. */
export type SessionPlatform = "web" | "native";

export type SessionState =
  /** Booting: restoring whatever session the device holds. */
  | { readonly status: "unknown" }
  /** Boot could not reach the server; nothing is known about the session. Retry. */
  | { readonly status: "unreachable"; readonly error: AppError }
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly auth: GetAuthStatusResponse };

export interface Session {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  /** unknown | unreachable | signedOut → refresh with what the device holds, then whoami. Idempotent while signed in. */
  bootstrap(): Promise<void>;
  /** Login; throws an AppError (unauthenticated = wrong credentials, throttled = wait) for the screen to show. */
  signIn(email: string, password: string): Promise<void>;
  /** Local-first and never fails: clears everything here, then tells the server best-effort. */
  signOut(): Promise<void>;
  /** Re-fetches GetAuthStatus while signed in (after a password change, an admin toggle, …). */
  refreshAuthStatus(): Promise<void>;
}
