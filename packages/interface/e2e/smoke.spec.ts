// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";

// The 3a.2 smoke: the web export boots in a real browser, the root layout
// mounts the providers, and the session bootstraps — which, with nothing
// answering the Connect routes behind `expo serve` (it serves index.html back),
// must end in the `unreachable` state (a Retry), never in a sign-out: the
// transport treats everything but an Unauthenticated from RefreshToken as
// transient (09l F4). The title is the generic one here, not "Can't reach the
// server": an HTML page where a Connect answer should be is `unknown`, not
// Unavailable. 3a.3 points the suite at the docker stack and walks the tracer.
test("the web export boots and the session bootstrap ends unreachable, not signed out", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("OCF IMS")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByText("Connecting…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
});
