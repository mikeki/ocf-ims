// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {test, expect, Page} from "@playwright/test";

const username = "Hardware";

function randomName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function login(page: Page): Promise<void> {
  await page.goto("http://localhost:8080/ims/app/");
  // wait for one of the buttons to be shown
  await expect(page.getByRole("button", { name: /^Log (In|Out)$/ })).toBeVisible();
  if (await page.getByRole("button", { name: "Log In" }).isVisible()) {
    await page.getByRole("button", { name: "Log In" }).click();
    await page.getByPlaceholder("name@example.com").click();
    await page.getByPlaceholder("name@example.com").fill(username);
    await page.getByPlaceholder("Password").fill(username);
    await page.getByPlaceholder("Password").press("Enter");
  }
  await expect(page.getByRole("button", { name: "Log Out" })).toBeVisible();
}

async function adminPage(page: Page): Promise<void> {
  await maybeOpenNav(page);
  await page.getByRole("button", { name: username }).click();
  await page.getByRole("link", { name: "Admin" }).click();
}

async function incidentTypePage(page: Page): Promise<void> {
  await adminPage(page);
  await page.getByRole("link", { name: "Incident Types" }).click();
}

async function eventsPage(page: Page): Promise<void> {
  await adminPage(page);
  await page.getByRole("link", { name: "Events" }).click();
}

async function addIncidentType(page: Page, incidentType: string): Promise<void> {
  await incidentTypePage(page);
  await page.getByPlaceholder("Chooch").fill(incidentType);
  await page.getByPlaceholder("Chooch").press("Enter");
}

async function addEvent(page: Page, eventName: string): Promise<void> {
  await eventsPage(page);
  await page.getByPlaceholder("Burn-A-Matic-3000").fill(eventName);
  await page.getByPlaceholder("Burn-A-Matic-3000").press("Enter");

  await expect(page.getByText(`Full readers for ${eventName}`)).toBeVisible();
  await expect(page.getByText(`Full writers for ${eventName}`)).toBeVisible();
  await expect(page.getByText(`Reporters for ${eventName}`)).toBeVisible();
  await expect(page.getByText(`Visit writers for ${eventName}`)).toBeVisible();
}

async function addWriter(page: Page, eventName: string, writer: string): Promise<void> {
  await eventsPage(page);

  const writers = page.locator("div.card").filter({has: page.getByText(`Full writers for ${eventName}`)});

  await writers.getByRole("textbox").fill(writer);
  await writers.getByRole("textbox").press("Enter");
  await expect(writers.getByText(writer)).toBeVisible({timeout: 5000});
}

async function addReporter(page: Page, eventName: string, writer: string): Promise<void> {
  await eventsPage(page);

  const reporters = page.locator("div.card").filter({has: page.getByText(`reporters for ${eventName}`)});

  await reporters.getByRole("textbox").fill(writer);
  await reporters.getByRole("textbox").press("Enter");
  await expect(reporters.getByText(writer)).toBeVisible({timeout: 5000});
}

async function maybeOpenNav(page: Page): Promise<void> {
  const toggler = page.getByLabel("Toggle navigation");
  await expect(async (): Promise<void> => {
    if (await toggler.isVisible() && (await toggler.getAttribute("aria-expanded")) === "false") {
      await page.locator(".navbar-toggler").click();
      expect(toggler.getAttribute("aria-expanded")).toEqual("true");
    }
  }).toPass();
}

test("themes", async ({ page }) => {
  await page.goto("http://localhost:8080/ims/app/");

  await maybeOpenNav(page);
  await page.getByTitle("Color scheme").getByRole("button").click();
  await page.getByRole("button", { name: "Dark" }).click();
  expect(await page.locator("html").getAttribute("data-bs-theme")).toEqual("dark");

  await page.reload();
  expect(await page.locator("html").getAttribute("data-bs-theme")).toEqual("dark");
  await maybeOpenNav(page);
  await page.getByTitle("Color scheme").getByRole("button").click();
  await page.getByRole("button", { name: "Light" }).click();
  expect(await page.locator("html").getAttribute("data-bs-theme")).toEqual("light");

  await page.reload();
  expect(await page.locator("html").getAttribute("data-bs-theme")).toEqual("light");
})

test("admin_incident_types", async ({ page }) => {
  await login(page);

  const incidentType: string = randomName("type");
  await addIncidentType(page, incidentType);

  await incidentTypePage(page);

  const newLi = page.locator("li", {hasText: incidentType});
  await expect(newLi).toBeVisible();
  await expect(newLi.getByRole("button", {name: "Active"})).toBeVisible();
  await expect(newLi.getByRole("button", {name: "Hidden"})).toBeHidden();

  await newLi.getByRole("button", {name: "Active"}).click();
  await expect(newLi.getByRole("button", {name: "Active"})).toBeHidden();
  await expect(newLi.getByRole("button", {name: "Hidden"})).toBeVisible();
});

test("incidents", async ({ page, browser }) => {
  test.slow();

  // make a new event with a writer
  await login(page);
  const eventName: string = randomName("event");
  await addEvent(page, eventName);
  await addWriter(page, eventName, "person:" + username);

  // check that we can navigate to the incidents page for that event
  await page.goto("http://localhost:8080/ims/app/");
  await maybeOpenNav(page);
  await page.getByRole("button", {name: "Event"}).click();
  await page.getByRole("link", {name: eventName}).click();
  expect(page.url()).toBe(`http://localhost:8080/ims/app/events/${eventName}/incidents`);

  await page.close();

  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage()
    await login(page);

    await page.goto(`http://localhost:8080/ims/app/events/${eventName}/incidents`);
    const incidentsPage = page;

    const incidentPage = await ctx.newPage();
    await incidentPage.goto(`http://localhost:8080/ims/app/events/${eventName}/incidents`);
    await incidentPage.getByRole("button", {name: "New"}).click();

    await expect(incidentPage.getByLabel("IMS #", {exact: true})).toHaveValue("(new)");
    const incidentSummary = randomName("summary");
    await incidentPage.getByLabel("Summary").fill(incidentSummary);
    await incidentPage.getByLabel("Summary").press("Tab");
    // wait for the new incident to be persisted
    await expect(incidentPage.getByLabel("IMS #", {exact: true})).toHaveValue(/^\d+$/);

    // check that the BroadcastChannel update to the first page worked
    await expect(incidentsPage.getByText(incidentSummary)).toBeVisible();

    // change the summary
    const newIncidentSummary = incidentSummary + " with suffix";
    await incidentPage.getByLabel("Summary").fill(newIncidentSummary);
    await incidentPage.getByLabel("Summary").press("Tab");
    // check that the BroadcastChannel update to the first page worked
    await expect(incidentsPage.getByText(newIncidentSummary)).toBeVisible();

    await incidentPage.getByLabel("State").selectOption("on_hold");
    await incidentPage.getByLabel("State").press("Enter");

    // add several incident types to the incident
    {
      async function addType(page: Page, type: string): Promise<void> {
        await page.getByLabel("Add Incident Type").fill(type);
        await page.getByLabel("Add Incident Type").press("Tab");

        await expect(
            page.locator("div.card").filter(
                {has: page.getByText("Incident Types")}
            ).locator("li", {hasText: type})).toBeVisible({timeout: 5000});
        await expect(page.getByLabel("Add Incident Type")).toHaveValue("");
      }

      await addType(incidentPage, "Medical");
      await addType(incidentPage, "Fire");
    }

    // add several people to the incident
    {
      async function addPerson(page: Page, personName: string): Promise<void> {
        await page.getByLabel("Add Person").fill(personName);
        // Search-first combobox (5e.2): pick the matching result, or the
        // "Create new person" fallback whose label also contains the typed name.
        await page.locator("#person_add_results")
            .getByRole("button", {name: personName}).first().click();
        await expect(page.locator("li", {hasText: personName})).toBeVisible({timeout: 5000});
        await expect(page.getByLabel("Add Person")).toHaveValue("");
        const involvementField = page.locator("li", {hasText: personName}).getByRole("textbox");
        await involvementField.fill(`${personName} Involvement`);
        await involvementField.press("Tab");
        // The value of the involvementField is checked later on in this test
      }

      await addPerson(incidentPage, "Doggy");
      await addPerson(incidentPage, "Runner");
      await addPerson(incidentPage, "Loosy");
      await addPerson(incidentPage, "TheMan");
    }

    // override start time
    let altStartedDatetime = incidentPage.locator("#alt_started_datetime");
    let altStartedDateTimeStr = "Mon 2025-01-27 @ 22:11";
    let ignoreDatetimeCheck = false;

    if (!await altStartedDatetime.isVisible()) {
      // The mobile datetime picker is harder to work with, and we can't just
      // fill the text field. We'll leave this problem for another day for mobile
      // (Mobile Chrome and Mobile Safari).
      if (await incidentPage.locator(".flatpickr-mobile").isVisible()) {
        ignoreDatetimeCheck = true;
      }
    }

    if (!ignoreDatetimeCheck) {
      await expect(altStartedDatetime).toBeVisible();
      await altStartedDatetime.clear();
      await altStartedDatetime.fill(altStartedDateTimeStr);
      const responsePromise = page.waitForResponse(response =>
          response.url().includes(`/ims/api/events/${eventName}/incidents/`)
          && response.request().method() === "GET"
      )
      await altStartedDatetime.press("Tab");
      await responsePromise;
    }

    // add location details
    {
      await incidentPage.getByLabel("Location name").click();
      await incidentPage.getByLabel("Location name").fill("Somewhere");
      await incidentPage.getByLabel("Location name").press("Tab");
      await incidentPage.getByLabel("Location address").fill("4:20 & F");
      await incidentPage.getByLabel("Additional location description").click();
      await incidentPage.getByLabel("Additional location description").fill("other there");
      await incidentPage.getByLabel("Additional location description").press("Tab");
      await incidentPage.getByLabel("Booth number").fill("B12");
      await incidentPage.getByLabel("Booth number").press("Tab");
    }
    // add a journal entry
    const journalEntry = `This is some text - ${randomName("text")}`;
    {
      await incidentPage.getByLabel("New journal entry text").fill(journalEntry);
      await incidentPage.getByLabel("Submit journal entry").click();
      await expect(incidentPage.getByText(journalEntry)).toBeVisible();
    }
    // strike the entry, verified it's stricken
    {
      await incidentPage.getByText(journalEntry).hover();
      await incidentPage.getByRole("button", {name: "Strike"}).click();
      await expect(incidentPage.getByText(journalEntry)).toBeHidden();
    }
    // but the entry is shown when the right checkbox is ticked
    {
      await incidentPage.getByLabel("Show history and stricken").check();
      await expect(incidentPage.getByText(journalEntry)).toBeVisible();
    }
    // unstrike the entry and see it return to the default view
    {
      await incidentPage.getByText(journalEntry).hover();
      await incidentPage.getByRole("button", {name: "Unstrike"}).click();
      await incidentPage.getByLabel("Show history and stricken").uncheck();
      await expect(incidentPage.getByText(journalEntry)).toBeVisible();
    }

    // link the incident to another incident
    {
      if (i > 0) {
        await incidentPage.getByLabel("Link IMS #").fill("1");
        await incidentPage.getByLabel("Link IMS #").press("Enter");
        const linkedIncident = incidentPage.getByText(`IMS ${eventName} #1: `);
        await expect(linkedIncident).toBeVisible();
      }
    }

    // reload the page, make sure some data loads again
    {
      await incidentPage.reload();
      const runnerPerson = incidentPage.getByLabel("Runner");
      await expect(runnerPerson).toBeVisible();
      const runnerRow = incidentPage.getByRole("listitem").filter({has: runnerPerson}).getByRole("textbox");
      await expect(runnerRow).toHaveValue("Runner Involvement");
      if (!ignoreDatetimeCheck) {
        await expect(altStartedDatetime).toBeVisible();
        await expect(altStartedDatetime).toHaveValue(altStartedDateTimeStr);
      }
    }

    // try searching for the incident by its journal text
    {
      await incidentsPage.getByRole("searchbox").fill(journalEntry);
      await incidentsPage.getByRole("searchbox").press("Enter");
      await expect(incidentsPage.getByText(newIncidentSummary)).toBeVisible();
      await incidentsPage.getByRole("searchbox").fill("The wrong text!");
      await incidentsPage.getByRole("searchbox").press("Enter");
      await expect(incidentsPage.getByText(newIncidentSummary)).toBeHidden();
      await incidentsPage.getByRole("searchbox").clear();
      await incidentsPage.getByRole("searchbox").press("Enter");
      await expect(incidentsPage.getByText(newIncidentSummary)).toBeVisible();
    }

    // close the incident and see it disappear from the default Incidents page view
    {
      await incidentPage.getByLabel("State").selectOption("closed");
      await incidentPage.getByLabel("State").press("Tab");
      await expect(incidentsPage.getByText(newIncidentSummary)).toBeHidden();
    }

    await incidentPage.close();
    await incidentsPage.close();
    await ctx.close();
  }
})


test("reports", async ({ page, browser }) => {
  test.slow();

  // make a new event with a writer
  await login(page);
  const eventName: string = randomName("event");
  await addEvent(page, eventName);
  await addReporter(page, eventName, "person:" + username);

  // check that we can navigate to the incidents page for that event
  await page.goto("http://localhost:8080/ims/app/");
  await maybeOpenNav(page);
  await page.getByRole("button", {name: "Event"}).click();
  await page.getByRole("link", {name: eventName}).click();
  // we'll first hit the Incidents page, but because we're a reporter, we'll
  // get auto-redirected to Reports.
  await page.waitForURL(`http://localhost:8080/ims/app/events/${eventName}/reports`)

  await page.close();

  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage()
    await login(page);

    await page.goto(`http://localhost:8080/ims/app/events/${eventName}/reports`);
    const tablePage = page;

    const reportPage = await ctx.newPage();
    await reportPage.goto(`http://localhost:8080/ims/app/events/${eventName}/reports`);
    await reportPage.getByRole("button", {name: "New"}).click();

    await expect(reportPage.getByLabel("FR #")).toHaveValue("(new)");
    const reportSummary = randomName("summary");
    await reportPage.getByLabel("Summary").fill(reportSummary);
    await reportPage.getByLabel("Summary").press("Tab");
    // wait for the new incident to be persisted
    await expect(reportPage.getByLabel("FR #")).toHaveValue(/^\d+$/);

    // check that the BroadcastChannel update to the first page worked
    await expect(tablePage.getByText(reportSummary)).toBeVisible();

      // change the summary
      const newSummary = reportSummary + " with suffix";
      await reportPage.getByLabel("Summary").fill(newSummary);
      await reportPage.getByLabel("Summary").press("Tab");
      // check that the BroadcastChannel update to the first page worked
      await expect(tablePage.getByText(newSummary)).toBeVisible();

      // add a journal entry
      const journalEntry = `This is some text - ${randomName("text")}`;
      {
        await reportPage.getByLabel("New journal entry text").fill(journalEntry);
        await reportPage.getByLabel("Submit journal entry").click();
        await expect(reportPage.getByLabel("New journal entry text")).toBeEmpty();
        await expect(reportPage.getByText(journalEntry)).toBeVisible();
      }
      // strike the entry, verified it's stricken
      {
        await reportPage.getByText(journalEntry).hover();
        await reportPage.getByRole("button", {name: "Strike"}).click({force: true});
        await expect(reportPage.getByText(journalEntry)).toBeHidden();
      }
      // but the entry is shown when the right checkbox is ticked
      {
        await reportPage.getByLabel("Show history and stricken").check();
        await expect(reportPage.getByText(journalEntry)).toBeVisible();
      }
      // unstrike the entry and see it return to the default view
      {
        await reportPage.getByText(journalEntry).hover();
        await reportPage.getByRole("button", {name: "Unstrike"}).click({force: true});
        await reportPage.getByLabel("Show history and stricken").uncheck();
        await expect(reportPage.getByText(journalEntry)).toBeVisible();
      }

      // try searching for the incident by its journal text
      {
        await tablePage.getByRole("searchbox").fill(journalEntry);
        await tablePage.getByRole("searchbox").press("Enter");
        await expect(tablePage.getByText(newSummary)).toBeVisible();
        await tablePage.getByRole("searchbox").fill("The wrong text!");
        await tablePage.getByRole("searchbox").press("Enter");
        await expect(tablePage.getByText(newSummary)).toBeHidden();
        await tablePage.getByRole("searchbox").clear();
        await tablePage.getByRole("searchbox").press("Enter");
        await expect(tablePage.getByText(newSummary)).toBeVisible();
      }

      await reportPage.close();
      await tablePage.close();
      await ctx.close();
  }
})


test("journal_draft_persistence", async ({ page, browser }) => {
  test.slow();

  // make a new event with a writer
  await login(page);
  const eventName: string = randomName("event");
  await addEvent(page, eventName);
  await addWriter(page, eventName, "person:" + username);
  await page.close();

  const ctx = await browser.newContext();
  const incidentPage = await ctx.newPage();
  await login(incidentPage);

  await incidentPage.goto(`http://localhost:8080/ims/app/events/${eventName}/incidents`);
  await incidentPage.getByRole("button", {name: "New"}).click();
  await expect(incidentPage.getByLabel("IMS #", {exact: true})).toHaveValue("(new)");

  // Type a journal entry, but do NOT submit it.
  const draft = `Draft text - ${randomName("text")}`;
  await incidentPage.getByLabel("New journal entry text").fill(draft);

  // It's debounced into localStorage under the not-yet-numbered "new" key.
  await expect.poll(async (): Promise<string|null> => incidentPage.evaluate(
      (ev: string): string|null => localStorage.getItem(`journal_draft_${ev}_incident_new`),
      eventName,
  )).toBe(draft);

  // Create the incident via a non-journal field edit, which assigns its number.
  // The draft key must migrate from "new" to the freshly-assigned number.
  const summary: string = randomName("summary");
  await incidentPage.getByLabel("Summary").fill(summary);
  await incidentPage.getByLabel("Summary").press("Tab");
  await expect(incidentPage.getByLabel("IMS #", {exact: true})).toHaveValue(/^\d+$/);
  const number: string = await incidentPage.getByLabel("IMS #", {exact: true}).inputValue();

  // The draft now lives under the numbered key, and the "new" key is cleared.
  await expect.poll(async (): Promise<string|null> => incidentPage.evaluate(
      (key: string): string|null => localStorage.getItem(key),
      `journal_draft_${eventName}_incident_${number}`,
  )).toBe(draft);
  expect(await incidentPage.evaluate(
      (ev: string): string|null => localStorage.getItem(`journal_draft_${ev}_incident_new`),
      eventName,
  )).toBeNull();

  // Reload: the draft is restored into the textarea, with a subtle note.
  await incidentPage.reload();
  await expect(incidentPage.getByLabel("New journal entry text")).toHaveValue(draft);
  await expect(incidentPage.getByText("Unsaved draft restored.")).toBeVisible();

  // Submitting the entry clears the local draft.
  await incidentPage.getByLabel("Submit journal entry").click();
  await expect(incidentPage.getByLabel("New journal entry text")).toBeEmpty();
  await expect(incidentPage.getByText(draft)).toBeVisible();
  await expect.poll(async (): Promise<string|null> => incidentPage.evaluate(
      (key: string): string|null => localStorage.getItem(key),
      `journal_draft_${eventName}_incident_${number}`,
  )).toBeNull();

  // A subsequent reload shows no restored draft.
  await incidentPage.reload();
  await expect(incidentPage.getByLabel("New journal entry text")).toBeEmpty();
  await expect(incidentPage.getByText("Unsaved draft restored.")).toBeHidden();

  await incidentPage.close();
  await ctx.close();
})

test("people_event_nav", async ({ page }) => {
  test.slow();

  // Make a new event so the event nav has a real (non-group) event to scope to.
  await login(page);
  const eventName: string = randomName("event");
  await addEvent(page, eventName);

  // Event doorway: from an event-scoped page, the nav shows a "People" link
  // (admin-only) that lands on the event-scoped People page.
  await page.goto(`http://localhost:8080/ims/app/events/${eventName}/incidents`);
  await maybeOpenNav(page);
  await page.getByRole("link", {name: "People", exact: true}).click();
  expect(page.url()).toBe(`http://localhost:8080/ims/app/events/${eventName}/people`);

  // The event picker is locked to the URL event.
  await expect(page.locator("#event-name")).toBeDisabled();
  await expect(page.locator("#event-name")).toHaveValue(eventName);

  // Admin doorway: the global entry still works and lets the user choose an
  // event (including "— no event —" for global identity work).
  await page.goto("http://localhost:8080/ims/app/admin/people");
  await expect(page.locator("#event-name")).toBeEnabled();
  await expect(page.locator("#event-name")).toHaveValue("");
})

test("dashboard", async ({ page }) => {
  test.slow();

  await login(page);
  const eventName: string = randomName("event");
  await addEvent(page, eventName);

  // From an event-scoped page, the nav shows a "Dashboard" link (admin-only)
  // that lands on the event-scoped dashboard.
  await page.goto(`http://localhost:8080/ims/app/events/${eventName}/incidents`);
  await maybeOpenNav(page);
  await page.getByRole("link", {name: "Dashboard", exact: true}).click();
  expect(page.url()).toBe(`http://localhost:8080/ims/app/events/${eventName}/dashboard`);

  // The page renders its headline counts (a fresh event has zero incidents) and
  // a chart canvas draws (Chart.js gives the canvas a non-zero rendered size).
  await expect(page.locator("#stat_total")).toHaveText("0");
  await expect(page.locator("#chart_state")).toBeVisible();
  const drew = await page.locator("#chart_state").evaluate(
    (c: HTMLCanvasElement) => c.clientWidth > 0 && c.clientHeight > 0);
  expect(drew).toBe(true);
})
