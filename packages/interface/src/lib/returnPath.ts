// SPDX-License-Identifier: Apache-2.0

// The login return path (plan 09n T3). On web, a signed-out visit to an app
// route redirects to `/login?o=<path>` and a successful sign-in returns there.
// The value comes from the URL, so it is untrusted: only a path inside the
// app's own routes is honoured — never a scheme, a host (`//evil`), a query, a
// dot segment or the login route itself. Anything else answers undefined and
// the caller falls back to `/`. The templ client's rule (web/typescript/login.ts:
// `internalDest` + `looksSafe`, code-scanning #4/#6), narrowed to this client.

/** The route prefix a return path must live under. */
export const RETURN_PATH_PREFIX = "/events";

const SAFE_PATH = /^[A-Za-z0-9_\-/]+$/;

export function safeReturnPath(o: unknown): string | undefined {
  if (typeof o !== "string") {
    return undefined;
  }
  if (!SAFE_PATH.test(o)) {
    return undefined;
  }
  if (o.startsWith("//")) {
    return undefined;
  }
  if (o !== RETURN_PATH_PREFIX && !o.startsWith(`${RETURN_PATH_PREFIX}/`)) {
    return undefined;
  }
  return o;
}

/**
 * Where a signed-out visitor is sent. Web carries the current app path so the
 * sign-in comes back to it; native (no shareable URL, no reload) goes to the
 * plain login route.
 */
export function loginHref(
  pathname: string | undefined,
  platform: string,
): string {
  if (platform !== "web") {
    return "/login";
  }
  const back = safeReturnPath(pathname);
  return back === undefined ? "/login" : `/login?o=${encodeURIComponent(back)}`;
}
