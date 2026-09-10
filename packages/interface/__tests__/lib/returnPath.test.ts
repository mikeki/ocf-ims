// SPDX-License-Identifier: Apache-2.0

import { loginHref, safeReturnPath } from "@/lib/returnPath";

// The login return path is an open-redirect guard (plan 09n T3): only a path
// under the app's own /events routes comes back; everything else is dropped.

describe("safeReturnPath", () => {
  it.each([
    "/events",
    "/events/1/incidents",
    "/events/1/incidents/42",
    "/events/12/incidents/",
  ])("accepts the in-app path %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    ["a scheme", "https://evil.example/events"],
    ["a protocol-relative host", "//evil.example/events"],
    ["a dot segment", "/events/../login"],
    ["a query string", "/events/1/incidents?x=1"],
    ["a fragment", "/events#x"],
    ["a space", "/events/1 /incidents"],
    ["an encoded slash", "/events%2F1"],
    ["a backslash", "/events\\evil"],
    ["a different route", "/login"],
    ["the root", "/"],
    ["a prefix that is not the route", "/eventsx/1"],
    ["a relative path", "events/1"],
    ["an empty string", ""],
  ])("rejects %s", (_, path) => {
    expect(safeReturnPath(path)).toBeUndefined();
  });

  it("rejects anything that is not a string (an array param, undefined)", () => {
    expect(safeReturnPath(undefined)).toBeUndefined();
    expect(safeReturnPath(["/events", "/events"])).toBeUndefined();
    expect(safeReturnPath(42)).toBeUndefined();
  });
});

describe("loginHref", () => {
  it("web: carries the current in-app path", () => {
    expect(loginHref("/events/1/incidents/3", "web")).toBe(
      "/login?o=%2Fevents%2F1%2Fincidents%2F3",
    );
  });

  it("web: drops a path it would not return to", () => {
    expect(loginHref("/", "web")).toBe("/login");
    expect(loginHref("/login", "web")).toBe("/login");
    expect(loginHref(undefined, "web")).toBe("/login");
  });

  it("native: never carries a return path", () => {
    expect(loginHref("/events/1/incidents", "ios")).toBe("/login");
    expect(loginHref("/events/1/incidents", "android")).toBe("/login");
  });
});
