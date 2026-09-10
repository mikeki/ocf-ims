// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";

// The read-only tracer (plan 09n T11): sign in → events → incidents →
// incident → sign out, against a real server. Environment-gated so CI never
// depends on one — this spec only runs when a person supplies credentials.
// Never `page.goto` mid-flow: in the interim mode (a local export talking
// cross-site to staging) a full page load re-bootstraps with no cookie and
// lands back on the login screen.

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const hosted = Boolean(process.env.E2E_BASE_URL); // same origin: the cookie survives a reload
test.skip(
  !email || !password,
  "set E2E_EMAIL and E2E_PASSWORD (and E2E_BASE_URL for the hosted build) to run the tracer against a server",
);

test("login → events → incidents → incident → sign out", async ({ page }) => {
  await page.goto("/"); // signed out → /login
  await page.getByLabel("Email").fill(email ?? "");
  await page.getByLabel("Password").fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/); // T4
  await page.getByRole("button", { name: "Events" }).click(); // ScreenHeader back
  const events = page.getByTestId(/^event-row-/);
  await expect(events.first()).toBeVisible();
  await events.first().click(); // the newest ("Current")
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);
  const incident = page.getByTestId(/^incident-row-/).first();
  await expect(incident).toBeVisible();
  await incident.click();
  await expect(page).toHaveURL(/\/incidents\/\d+$/);
  await expect(page.getByText(/^#\d+$/).first()).toBeVisible();
  if (hosted) {
    // the web session resumes
    await page.reload();
    await expect(page.getByText(/^#\d+$/).first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Incidents" }).click();
  await page.getByRole("button", { name: "Events" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  if (hosted) {
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  }
});
