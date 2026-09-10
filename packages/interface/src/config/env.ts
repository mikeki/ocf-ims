// SPDX-License-Identifier: Apache-2.0

import Constants from "expo-constants";
import { Platform } from "react-native";

// Where the server is (plan 09l F13). Precedence:
//
//   1. EXPO_PUBLIC_API_URL — explicit, always wins. Inlined into production
//      bundles by babel-preset-expo; read from the process at runtime in dev.
//   2. Web: the page's own origin. Production serves the web export and the
//      Connect routes from one host (09i E9), so nothing needs configuring.
//   3. A native development build: the machine running Metro also runs the
//      docker dev stack, so derive `http://<metro host>:8090` from the dev
//      server's hostUri (expo-constants).
//   4. Otherwise fail loudly: a production native build must set the variable.

/** The docker dev stack's host port (docker-compose.dev.yml IMS_HOST_PORT). */
export const DEV_STACK_PORT = 8090;

export interface ApiBaseUrlInputs {
  /** The EXPO_PUBLIC_API_URL value, if set. */
  envUrl: string | undefined;
  platform: string;
  /** window.location.origin on web, undefined elsewhere. */
  origin: string | undefined;
  /** expo-constants hostUri, e.g. "192.168.1.5:8081", in a dev build. */
  hostUri: string | undefined;
  dev: boolean;
}

export function resolveApiBaseUrl(inputs: ApiBaseUrlInputs): string {
  const envUrl = inputs.envUrl?.trim();
  if (envUrl) {
    return stripTrailingSlash(envUrl);
  }
  if (inputs.platform === "web" && inputs.origin) {
    return stripTrailingSlash(inputs.origin);
  }
  if (inputs.dev && inputs.hostUri) {
    const host = inputs.hostUri.split(":")[0];
    if (host) {
      return `http://${host}:${DEV_STACK_PORT}`;
    }
  }
  throw new Error(
    "EXPO_PUBLIC_API_URL is not set and no default applies on this platform",
  );
}

export function apiBaseUrl(): string {
  return resolveApiBaseUrl({
    // Written out in full: babel-preset-expo only inlines a literal
    // `process.env.EXPO_PUBLIC_*` member expression.
    envUrl: process.env.EXPO_PUBLIC_API_URL,
    platform: Platform.OS,
    origin: typeof window === "undefined" ? undefined : window.location.origin,
    hostUri: Constants.expoConfig?.hostUri,
    dev: __DEV__,
  });
}

/**
 * JSON on the wire in development (readable in devtools and the server log),
 * binary in production (09i E3).
 */
export function binaryWireFormat(): boolean {
  return !__DEV__;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
