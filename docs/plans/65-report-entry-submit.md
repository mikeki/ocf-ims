# Phase 6 — Feedback Round 5, Slice 6k (journal-entry submit keybinding)

> **Status:** Plan — for review. **Owner:** TBD · **Last updated:** 2026-06-28
>
> Fifth feedback round from live beta use. Three independent report-focused
> items, each its own plan, sequenceable in any order:
>
> - **6k** (this plan) — entry-submit keybinding: **Enter submits** on incidents;
>   **button-only** on reports.
> - **6l** — [show IMS# on a new report + attach-on-create](66-new-report-incident-link.md).
> - **6m** — [reporter vs submitter on a report](67-report-reporter-submitter.md).

## 1. Goal

Make journal-entry submission match how each page is used:

- **Incidents** are logged in quick lines — pressing **Enter** should submit the
  entry (fast, low-friction).
- **Reports** are written as a narrative — Enter should **insert a newline**, and
  the entry should submit **only via the Submit button**, so a half-written
  report is never posted prematurely (the Maintainer's words: *"reports should
  only submit when clicking submit"*).

Frontend-only. No schema, API, or JSON change.

## 2. Current state (verified)

- Both the incident and report pages share one keydown handler,
  `ims.handleJournalKeydown(e, submitEnabled)` (`web/typescript/ims.ts:2293`),
  wired on each page's `journal_entry_add` textarea
  (`incident.ts:292`, `report.ts:167`).
- Submit mode is a **single global** localStorage pref,
  `journal_submit_on_enter` (`ims.ts:2278`), default **false** = Ctrl/⌘/Alt+Enter
  submits, plain Enter inserts a newline. A GitHub-style split-button dropdown
  next to Submit (`.journal-submit-mode` items, `data-mode`) lets the user flip
  it; `setupJournalSubmitMode()` (`ims.ts:2315`) labels the button + wires the
  dropdown. Both `incident.templ` (~L345-354) and `report.templ` (~L199-208)
  carry an identical dropdown.
- `handleJournalKeydown` is **not** page-type aware, but the module already knows
  the page: `journalDraftPageType` is set per page via
  `setJournalDraftPageType("incident"|"report")` (`incident.ts:144`,
  `report.ts:80`), **before** the keydown listener is attached.

## 3. Design

1. **Reports never keyboard-submit.** Add an early return at the top of
   `handleJournalKeydown` (`ims.ts`): `if (journalDraftPageType === "report")
   return;`. Plain Enter then falls through to default textarea behavior
   (newline); only the Submit button posts.
2. **Incidents default to Enter-submits.** Flip the default of
   `journalSubmitOnEnter()` to **true** unless explicitly opted out — return
   `localStorage.getItem(key) !== "false"`. Users who previously chose Ctrl keep
   it; everyone else now gets Enter out of the box. The incident dropdown stays,
   so a user can switch back to Ctrl.
3. **Drop the submit-mode UI on reports.** It's meaningless when reports are
   button-only:
   - `report.ts`: remove the `ims.setupJournalSubmitMode()` call (L170).
   - `report.templ`: remove the split-button caret + the `.dropdown-menu` `<ul>`
     from the submit block; keep a single plain button labeled **"Submit"**
     (drop "Submit (Control ⏎)").
4. **Incidents unchanged** beyond the default flip — they keep
   `setupJournalSubmitMode()` and the dropdown.

Notes: `journalEntryEdited()`'s caret-recolor code already tolerates a missing
`.journal-submit-caret` (filtered), so it's safe on reports. The visits page is
disabled for 2026; its (incident-like) default behavior is untouched.

## 4. Files

- `web/typescript/ims.ts` — `journalSubmitOnEnter()` default flip;
  `handleJournalKeydown()` report early-return.
- `web/typescript/report.ts` — drop `setupJournalSubmitMode()` call.
- `web/template/report.templ` — simplify the submit button, remove the dropdown.

## 5. Tests / verification

- `npx eslint`; build with `go run bin/build/build.go` (tsgo is the TS gate).
- Manual (`docker compose -f docker-compose.dev.yml up`):
  - Incident: typing an entry and pressing **Enter** submits it; Shift+Enter adds
    a newline; the dropdown can switch back to Ctrl.
  - Report: **Enter inserts a newline**; only the **Submit** button posts; no
    submit-mode dropdown is present.
- Playwright (not in CI) is the natural regression guard for both pages.
