// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "@playwright/test";

// The read-only tracer (plan 09n T11): sign in → events → incidents →
// incident → sign out, against a real server. Environment-gated so CI never
// depends on one — this spec only runs when a person supplies credentials.
// Never `page.goto` mid-flow: in the interim mode (a local export talking
// cross-site to staging) a full page load re-bootstraps with no cookie and
// lands back on the login screen.
// The incident detail is asserted by `incident-number`, not by a `#\d+`
// text match: since 09o every row of the list renders its number as a bare
// "#123" of its own, and the list stays mounted (hidden) under the detail.

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
  // exact: the PasswordField's reveal button is also labelled "…Password".
  await page.getByLabel("Password", { exact: true }).fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/); // T4
  await page.getByRole("button", { name: "Events" }).click(); // ScreenHeader back
  const events = page.getByTestId(/^event-row-/);
  await expect(events.first()).toBeVisible();
  await events.first().click(); // the newest ("Current")
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);
  // The Board's segments (3b.1). aria-selected is asserted here because only a
  // real browser proves RN Web's DOM mapping.
  await expect(page.getByTestId("board-segment-mine")).toBeVisible();
  await expect(page.getByTestId("board-segment-mine")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByTestId("board-segment-all").click();
  await expect(page.getByTestId("board-segment-all")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId(/^incident-row-/).first()).toBeVisible();
  await page.getByTestId("board-segment-mine").click();

  const incident = page.getByTestId(/^incident-row-/).first();
  await expect(incident).toBeVisible();
  await incident.click();
  await expect(page).toHaveURL(/\/incidents\/\d+$/);
  await expect(page.getByTestId("incident-number")).toBeVisible();
  if (hosted) {
    // the web session resumes
    await page.reload();
    await expect(page.getByTestId("incident-number")).toBeVisible();
  }
  await page.getByRole("button", { name: "Board" }).click();
  await page.getByRole("button", { name: "Events" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  if (hosted) {
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  }
});

// A signed-out deep link (T3): the login carries `?o=`, sign-in returns to the
// incident, and "Board" from there goes to the list — not to whatever the
// stack happened to hold beneath a deep-linked screen (the anchor). The
// incident's URL is discovered first, since the seed's numbers are not fixed.
test("a signed-out deep link returns to the incident after sign-in; back goes to the list", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(email ?? "");
  // exact: the PasswordField's reveal button is also labelled "…Password".
  await page.getByLabel("Password", { exact: true }).fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);
  const incident = page.getByTestId(/^incident-row-/).first();
  await expect(incident).toBeVisible();
  await incident.click();
  await expect(page).toHaveURL(/\/incidents\/\d+$/);
  const detailPath = new URL(page.url()).pathname;
  const listPath = detailPath.replace(/\/\d+$/, "");

  // Drop the session (the hosted build's cookie; the interim mode never had
  // one) and load the incident directly.
  await page.context().clearCookies();
  await page.goto(detailPath);
  await expect(page).toHaveURL(/\/login\?o=/); // the return path rides along (T3)
  await page.getByLabel("Email").fill(email ?? "");
  // exact: the PasswordField's reveal button is also labelled "…Password".
  await page.getByLabel("Password", { exact: true }).fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  await expect(page.getByTestId("incident-number")).toBeVisible();
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(new RegExp(`${listPath}$`));
  await page.getByRole("button", { name: "Events" }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
