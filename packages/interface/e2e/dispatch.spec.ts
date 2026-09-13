// SPDX-License-Identifier: Apache-2.0

/// <reference types="node" />

import { expect, test } from "@playwright/test";

// The dispatch table's own walk (plan 09x criterion 16), gated exactly like
// e2e/tracer.spec.ts: only runs with credentials, against a real server, and
// only proves anything at the wide breakpoint (1440x900) the table needs.
// Sign in → events → the table renders → `/` focuses the search → a bare
// number plus Enter opens the drawer → `j`/`k` walk it → Enter opens the full
// page → `j` moves the page → Esc back to the drawer → Esc back to the table
// with the search kept → sign out.

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
test.skip(
  !email || !password,
  "set E2E_EMAIL and E2E_PASSWORD (and E2E_BASE_URL for the hosted build) to run the dispatch walk against a server",
);

test.use({ viewport: { width: 1440, height: 900 } });

test("dispatch: search opens the drawer, a second Enter opens the full page, Esc walks back", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(email ?? "");
  // exact: the PasswordField's reveal button is also labelled "…Password".
  await page.getByLabel("Password", { exact: true }).fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events\/\d+\/incidents$/);

  // The table renders (criterion 3) — the wide layout, not the phone's Board.
  const table = page.getByTestId("dispatch-table");
  await expect(table).toBeVisible();
  const row = page.getByTestId(/^dispatch-row-\d+$/).first();
  await expect(row).toBeVisible();
  const rowTestId = await row.getAttribute("data-testid");
  const number = /^dispatch-row-(\d+)$/.exec(rowTestId ?? "")?.[1];
  if (!number) {
    throw new Error("no incident row testID found to search for");
  }

  // `/` focuses the search (criterion 11); a bare number plus Enter jumps to
  // that incident, opening the drawer (criterion 5, criterion 7).
  await page.keyboard.press("/");
  const search = page.getByTestId("dispatch-search");
  await expect(search).toBeFocused();
  await search.pressSequentially(number);
  await search.press("Enter");
  const drawer = page.getByTestId("dispatch-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(`#${number}`).first()).toBeVisible();
  // The keyboard map is suppressed while the search has focus; hand focus to
  // the drawer the way clicking into it would, so j/k/Enter reach the map.
  await search.blur();

  // j/k walk the drawer's selection (criteria 7, 11) without closing it.
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await expect(drawer).toBeVisible();

  // Enter again pushes the full page (criterion 9); the table is gone.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/incidents\/\d+(\?.*)?$/);
  await expect(table).not.toBeVisible();
  await expect(page.getByTestId("incident-number")).toBeVisible();

  // j moves the page to its next incident — Next/Prev must be visible here:
  // the table's push always carries `from=table` (finding 4), even from its
  // bare default query, so a page opened from the table always has neighbours.
  const next = page.getByTestId("incident-page-next");
  await expect(next).toBeVisible();
  const before = page.url();
  await page.keyboard.press("j");
  await expect(page).not.toHaveURL(before);

  // Esc backs to the drawer (the table beneath still holds sel/open — 09x
  // criterion 9), then closes the drawer, keeping the search text (criterion 6).
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(search).toHaveValue(number);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
