// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";

// The 3a.2 smoke: the web export boots in a real browser, the root layout
// mounts the providers, and the session bootstraps — which, with nothing
// answering the Connect routes behind `expo serve` (it serves index.html back),
// must end in the `unreachable` state (a Retry), never in a sign-out: the
// transport treats everything but an Unauthenticated from RefreshToken as
// transient (09l F4). Since 09n the app boots into the `(app)` route group's
// layout (T1), which renders `Unreachable` directly for that state — Retry
// visible, no "Connecting…", no "Sign in" — there is no login screen to show
// "OCF IMS" on. This test skips whenever a real server might answer instead
// of `expo serve`'s index.html fallback (E2E_EMAIL, or E2E_BASE_URL pointing
// `e2e/tracer.spec.ts` at one) — its "nothing answers the RPCs" premise would
// be false. `tracer.spec.ts` is the suite that walks the full flow against a
// server.
test.skip(
  Boolean(process.env.E2E_EMAIL) || Boolean(process.env.E2E_BASE_URL),
  "this smoke assumes nothing answers the Connect routes; run it without E2E_EMAIL/E2E_BASE_URL",
);

test("the web export boots and the session bootstrap ends unreachable, not signed out", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByText("Connecting…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
});
