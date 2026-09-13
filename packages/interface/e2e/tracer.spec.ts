// SPDX-License-Identifier: Apache-2.0

/// <reference types="node" />

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

// Filing and appending (plan 09r, slice 3b.2): a tap on the Board's bar pulls
// up the form, the filed incident replaces it, and the docked composer appends an
// entry that mentions someone from the typeahead. Test content only — the
// staging seed keeps what this files.
test("file an incident from the Board's bar, append an entry with a mention", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(email ?? "");
  // exact: the PasswordField's reveal button is also labelled "…Password".
  await page.getByLabel("Password", { exact: true }).fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);

  const stamp = new Date().toISOString();
  await page.getByTestId("quick-bar").click();
  await expect(page).toHaveURL(/\/incidents\/new$/);
  await page.getByTestId("summary").fill(`Tracer test incident ${stamp}`);
  await page.getByTestId("priority-low").click();
  await page.getByTestId("description").fill("Filed by the tracer; ignore.");
  await page.getByTestId("file-incident").click();
  await expect(page).toHaveURL(/\/incidents\/\d+$/);
  await expect(page.getByTestId("incident-number")).toBeVisible();
  // Scoped: the Board stays mounted beneath the detail, and its rows carry "Low" too.
  await expect(
    page.getByTestId("incident-refresh-control").getByText("Low"),
  ).toBeVisible();

  const composer = page.getByTestId("append-text");
  await composer.click();
  await composer.pressSequentially("Tracer entry, hello @sh");
  const match = page.getByTestId(/^mention-\d+$/).first();
  await expect(match).toBeVisible();
  await match.click();
  await page.getByTestId("append-send").click();
  await expect(
    page.getByText(/Tracer entry, hello @\S+/).first(),
  ).toBeVisible();
  await expect(page.getByTestId("append-text")).toHaveValue("");

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);
  await page.getByRole("button", { name: "Events" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

// Reports (plan 09t, slice 3b.3b): the Reports segment offers the report bar,
// the form files with a summary and details, the report replaces the form and
// its composer appends an entry. Test content only — the staging seed keeps it.
test("file a report from the Board's Reports segment, append an entry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(email ?? "");
  // exact: the PasswordField's reveal button is also labelled "…Password".
  await page.getByLabel("Password", { exact: true }).fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);

  const stamp = new Date().toISOString();
  await page.getByTestId("board-segment-reports").click();
  await page.getByTestId("quick-bar-report").click();
  await expect(page).toHaveURL(/\/reports\/new$/);
  await page.getByTestId("report-summary").fill(`Tracer test report ${stamp}`);
  await page
    .getByTestId("report-details")
    .fill("Filed by the tracer; ignore. Nothing happened.");
  await page.getByTestId("file-report").click();
  await expect(page).toHaveURL(/\/reports\/\d+$/);
  await expect(page.getByTestId("report-number")).toBeVisible();
  await expect(page.getByText("Nothing happened.")).toBeVisible();

  const composer = page.getByTestId("report-append-text");
  await composer.click();
  await composer.fill("Tracer follow-up entry.");
  await page.getByTestId("report-append-send").click();
  // Scoped: the composer's textarea still holds the text until the draft clears.
  await expect(
    page
      .getByTestId("report-refresh-control")
      .getByText("Tracer follow-up entry."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);
  await page.getByRole("button", { name: "Events" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

// Photos (plan 09s, slice 3b.4b): a photo on the filing form rides after the
// incident is filed, renders inline in the journal, and opens at full width.
// The web picker is a file input, so the chooser is answered with a generated
// PNG — test content only.
test("file an incident with a photo, see it in the journal, open it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(email ?? "");
  await page.getByLabel("Password", { exact: true }).fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);

  const stamp = new Date().toISOString();
  await page.getByTestId("quick-bar").click();
  await expect(page).toHaveURL(/\/incidents\/new$/);
  await page.getByTestId("summary").fill(`Tracer test photo ${stamp}`);
  await page.getByTestId("priority-low").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("photo-add").click();
  await (await chooser).setFiles({
    name: "tracer.png",
    mimeType: "image/png",
    buffer: Buffer.from(TRACER_PNG, "base64"),
  });
  await expect(page.getByTestId("photo-chip")).toBeVisible();
  await expect(page.getByText("Photo ready to send")).toBeVisible();
  await page.getByTestId("file-incident").click();
  await expect(page).toHaveURL(/\/incidents\/\d+$/);
  await expect(page.getByTestId("incident-number")).toBeVisible();

  const image = page.getByTestId(/^attachment-image-\d+$/).first();
  await expect(image).toBeVisible();
  await page
    .getByTestId(/^attachment-open-\d+$/)
    .first()
    .click();
  await expect(page).toHaveURL(/\/attachments\/\d+\/\d+$/);
  await expect(page.getByTestId("attachment-full")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/incidents\/\d+$/);

  await page.getByRole("button", { name: "Board" }).click();
  await page.getByRole("button", { name: "Events" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

/** A 2×2 orange PNG. */
const TRACER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwHwyBFAMDGIIBAG4bDfXkxT4nAAAAAElFTkSuQmCC";
