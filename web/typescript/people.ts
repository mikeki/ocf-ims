//
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
//

"use strict";

import * as ims from "./ims.ts";

declare global {
    interface Window {
        changeEvent: ()=>Promise<void>;
        changeShowAll: ()=>Promise<void>;
        filterPeople: ()=>void;
        submitSetPassword: ()=>Promise<void>;
        showAddPersonModal: ()=>void;
        showCreatePersonForm: ()=>void;
        backToPersonSearch: ()=>void;
        toggleProvideAccess: ()=>void;
        submitCreatePerson: ()=>Promise<void>;
        submitEditPerson: ()=>Promise<void>;
        submitMarkParticipation: (participation: string)=>Promise<void>;
        submitRemoveFromEvent: ()=>Promise<void>;
    }
}

const minPasswordLength = 8;

type RoleRung = {value: string; label: string; hint: string};

// The per-event standing rungs offered by the inline role menu on each roster row
// (slice 52e). These are the "present at the fair" rungs, top (most access) to
// bottom; picking one writes immediately via the participation endpoint. The
// removal rungs (not_present / ejected) are intentionally NOT here — those stay
// behind the "Remove from event" modal, which frames them with explanatory copy.
//
// writer and crew_leader are admin-only (plan 53d): minting an inviter/writer stays
// an admin act, so a non-admin inviter's menu tops out at reporter.
const adminOnlyRungs: RoleRung[] = [
    {value: "writer", label: "Writer", hint: "full access"},
    {value: "crew_leader", label: "Crew leader", hint: "own reports + invite"},
];
const inviterRungs: RoleRung[] = [
    {value: "reporter", label: "Reporter", hint: "own reports"},
    {value: "volunteer", label: "Volunteer", hint: "at the fair, no access"},
    {value: "public", label: "Public", hint: "attendee / on an incident"},
];

// roleRungsForViewer returns the rungs the current viewer may assign via the inline
// menu: an admin gets the full ladder, a non-admin inviter only reporter-and-below.
function roleRungsForViewer(): RoleRung[] {
    return isAdmin ? [...adminOnlyRungs, ...inviterRungs] : inviterRungs;
}

// The roles assignable to someone with no IMS login. The access-bearing rungs
// (writer / crew_leader / reporter) grant permissions that only mean something with
// a sign-in, so a name-only person is limited to the no-access roles.
const noLoginRoleValues = new Set(["volunteer", "public"]);

// roleRungsForPerson narrows the viewer's assignable rungs to those that make sense
// for this person: a name-only person (no fair name/email) can only be a volunteer or
// public, since the higher rungs imply a login they don't have.
function roleRungsForPerson(person: ims.Personnel): RoleRung[] {
    const rungs = roleRungsForViewer();
    return hasImsAccess(person) ? rungs : rungs.filter(r => noLoginRoleValues.has(r.value));
}

// targetAboveInviterCeiling reports whether a person's current per-event role is one
// a non-admin inviter may not touch (writer / crew_leader) — the anti-escalation
// ceiling mirrored from the server (53b). Admins are never ceilinged.
function targetAboveInviterCeiling(type: string|null|undefined): boolean {
    return type === "writer" || type === "crew_leader";
}

// participationBadgeClass picks a Bootstrap contextual color so the role stays
// scannable down a long roster — the access-bearing rungs (writer/crew_leader/
// reporter) pop, the kept-but-inactive states keep their slice-6j warning/secondary
// cues.
function participationBadgeClass(type: string): string {
    switch (type) {
        case "writer": return "text-bg-primary";
        case "crew_leader": return "text-bg-success";
        case "reporter": return "text-bg-info";
        case "ejected": return "text-bg-warning";
        case "not_present": return "text-bg-secondary";
        default: return "text-bg-light"; // volunteer, public
    }
}

// Page-level capability flags, set in initPeoplePage from the caller's auth:
//   isAdmin   — holds GlobalAdministratePersonnel: the full People powers (edit
//               profiles, reset passwords, toggle admin, assign any rung).
//   canInvite — holds EventInviteReporters on the (pinned) event: a writer or crew
//               leader who may invite reporters and manage reporter-or-below roster.
let isAdmin = false;
let canInvite = false;

// Remembers the last event the People page was scoped to, so per-event wristband
// and participation are shown (and editable) again on the next visit.
const lastEventKey = "admin_people_event";

const el = {
    eventName: ims.typedElement("event-name", HTMLSelectElement),
    eventPickerWrap: ims.typedElement("event_picker_wrap", HTMLElement),
    peopleSearch: ims.typedElement("people-search", HTMLInputElement),
    people: ims.typedElement("people", HTMLElement),
    peopleWithAccess: ims.typedElement("people_with_access", HTMLTableSectionElement),
    peopleWithoutAccess: ims.typedElement("people_without_access", HTMLTableSectionElement),
    personRowTemplate: ims.typedElement("person_row_template", HTMLTemplateElement),
    setPasswordModal: ims.typedElement("setPasswordModal", HTMLElement),
    setPasswordHandle: ims.typedElement("set_password_fair_name", HTMLElement),
    setPasswordInput: ims.typedElement("set_password_input", HTMLInputElement),
    setPasswordConfirm: ims.typedElement("set_password_confirm", HTMLInputElement),
    setPasswordToggle: ims.typedElement("set_password_toggle", HTMLButtonElement),
    setPasswordConfirmToggle: ims.typedElement("set_password_confirm_toggle", HTMLButtonElement),
    addPersonButton: ims.typedElement("add_person_button", HTMLButtonElement),
    addPersonModal: ims.typedElement("addPersonModal", HTMLElement),
    addPersonModalLabel: ims.typedElement("addPersonModalLabel", HTMLElement),
    addPersonSubmit: ims.typedElement("add_person_submit", HTMLButtonElement),
    addPersonInviteNote: ims.typedElement("add_person_invite_note", HTMLElement),
    addPersonWristbandWrap: ims.typedElement("add_person_wristband_wrap", HTMLElement),
    addPersonParticipationWrap: ims.typedElement("add_person_participation_wrap", HTMLElement),
    addPersonName: ims.typedElement("add_person_legal_name", HTMLInputElement),
    addPersonHandle: ims.typedElement("add_person_fair_name", HTMLInputElement),
    addPersonEmail: ims.typedElement("add_person_email", HTMLInputElement),
    addPersonEmailWrap: ims.typedElement("add_person_email_wrap", HTMLElement),
    addPersonEmailLabel: ims.typedElement("add_person_email_label", HTMLElement),
    addPersonEmailHome: ims.typedElement("add_person_email_home", HTMLElement),
    addPersonPhone: ims.typedElement("add_person_phone", HTMLInputElement),
    addPersonPassword: ims.typedElement("add_person_password", HTMLInputElement),
    addPersonPasswordConfirm: ims.typedElement("add_person_password_confirm", HTMLInputElement),
    addPersonPasswordToggle: ims.typedElement("add_person_password_toggle", HTMLButtonElement),
    addPersonPasswordConfirmToggle: ims.typedElement("add_person_password_confirm_toggle", HTMLButtonElement),
    addPersonAccessToggle: ims.typedElement("add_person_access_toggle", HTMLButtonElement),
    addPersonAccessSection: ims.typedElement("add_person_access_section", HTMLElement),
    addPersonCreateSection: ims.typedElement("add_person_create_section", HTMLElement),
    addPersonBackToSearch: ims.typedElement("add_person_back_to_search", HTMLButtonElement),
    addPersonEventSection: ims.typedElement("add_person_event_section", HTMLElement),
    addPersonEventName: ims.typedElement("add_person_event_name", HTMLElement),
    addPersonWristband: ims.typedElement("add_person_wristband", HTMLInputElement),
    addPersonParticipation: ims.typedElement("add_person_participation", HTMLSelectElement),
    editPersonModal: ims.typedElement("editPersonModal", HTMLElement),
    editPersonHandle: ims.typedElement("edit_person_fair_name", HTMLInputElement),
    editPersonName: ims.typedElement("edit_person_legal_name", HTMLInputElement),
    editPersonEmail: ims.typedElement("edit_person_email", HTMLInputElement),
    editPersonPhone: ims.typedElement("edit_person_phone", HTMLInputElement),
    editPersonEventSection: ims.typedElement("edit_person_event_section", HTMLElement),
    editPersonEventName: ims.typedElement("edit_person_event_name", HTMLElement),
    editPersonWristband: ims.typedElement("edit_person_wristband", HTMLInputElement),
    editPersonParticipation: ims.typedElement("edit_person_participation", HTMLSelectElement),
    showAllWrap: ims.typedElement("show_all_people_wrap", HTMLElement),
    showAllCheckbox: ims.typedElement("show-all-people", HTMLInputElement),
    addPersonSearchSection: ims.typedElement("add_person_search_section", HTMLElement),
    addPersonSearchEvent: ims.typedElement("add_person_search_event", HTMLElement),
    addPersonSearch: ims.typedElement("add_person_search", HTMLInputElement),
    addPersonSearchResults: ims.typedElement("add_person_search_results", HTMLElement),
    removeFromEventModal: ims.typedElement("removeFromEventModal", HTMLElement),
    removePersonLabel: ims.typedElement("remove_person_label", HTMLElement),
    removeEventName: ims.typedElement("remove_event_name", HTMLElement),
};

// The page serves two doorways (docs/plans/62-people-event-nav.md):
//   - event doorway  (/ims/app/events/{event}/people): pinned to the URL event;
//     the picker is locked to it.
//   - admin doorway  (/ims/app/admin/people): no URL event, the user picks one
//     (remembered in localStorage), and "— no event —" is allowed for global work.

initPeoplePage();

async function initPeoplePage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
    // Read the event from the path *after* commonPageInit() has populated pathIds.
    const urlEvent: string|null = ims.pathIds.eventName;
    isAdmin = initResult.authInfo.canManagePersonnel;
    // ims.eventAccess is the access map for the URL event (null on the no-event admin
    // doorway), so inviteReporters here means "may invite on the pinned event".
    canInvite = ims.eventAccess?.inviteReporters ?? false;
    if (!isAdmin) {
        // A non-admin inviter manages people only through the event-scoped doorway,
        // and only for an event they may invite reporters to. The global/no-event
        // admin doorway and everything it allows (profiles, passwords, admin) stay
        // admin-only.
        if (urlEvent == null || !canInvite) {
            ims.setErrorMessage("You don't have permission to manage people for this event.");
            ims.hideLoadingOverlay();
            return;
        }
    }

    window.changeEvent = changeEvent;
    window.changeShowAll = changeShowAll;
    window.filterPeople = filterPeople;
    window.submitSetPassword = submitSetPassword;
    window.showAddPersonModal = showAddPersonModal;
    window.showCreatePersonForm = showCreatePersonForm;
    window.backToPersonSearch = backToPersonSearch;
    window.toggleProvideAccess = toggleProvideAccess;
    window.submitCreatePerson = submitCreatePerson;

    // Bind the Show/Hide buttons on every password field once (these inputs live for
    // the life of the page; the modals just reset them to masked on open).
    ims.wirePasswordToggle(el.setPasswordToggle, el.setPasswordInput);
    ims.wirePasswordToggle(el.setPasswordConfirmToggle, el.setPasswordConfirm);
    ims.wirePasswordToggle(el.addPersonPasswordToggle, el.addPersonPassword);
    ims.wirePasswordToggle(el.addPersonPasswordConfirmToggle, el.addPersonPasswordConfirm);
    window.submitEditPerson = submitEditPerson;
    window.submitMarkParticipation = submitMarkParticipation;
    window.submitRemoveFromEvent = submitRemoveFromEvent;

    // The top button is a full "Add person" form for admins, a scoped "Invite
    // reporter" for a non-admin inviter (53d).
    el.addPersonButton.textContent = isAdmin ? "Add person" : "Invite reporter";

    await loadEventOptions();

    if (urlEvent != null) {
        // Event doorway: pin and lock the picker to the URL event.
        if (![...el.eventName.options].some(o => o.value === urlEvent)) {
            // Defensive: the URL event should already be a real (non-group) option.
            const opt = document.createElement("option");
            opt.value = urlEvent;
            opt.textContent = urlEvent;
            el.eventName.append(opt);
        }
        el.eventName.value = urlEvent;
        // The event is already pinned by the URL, so the picker is redundant here —
        // hide the whole control rather than showing a disabled, unusable dropdown.
        el.eventPickerWrap.classList.add("hidden");
        currentEvent = urlEvent;
    } else {
        // Admin doorway: restore the last-scoped event so per-event info shows again.
        const lastEvent = localStorage.getItem(lastEventKey);
        if (lastEvent && [...el.eventName.options].some(o => o.value === lastEvent)) {
            el.eventName.value = lastEvent;
        }
        currentEvent = el.eventName.value.trim();
    }
    reflectEventSelection();

    // The Add Person modal is search-first: typing searches the whole registry; an
    // existing person is enrolled into the current event, and if no one matches the
    // form below creates a new person. allowCreate is false because that create path
    // IS the form, not a dropdown row. The combobox's event scope only decorates the
    // result badges; enrollPerson reads the live currentEvent.
    ims.setupPersonCombobox({
        input: el.addPersonSearch,
        results: el.addPersonSearchResults,
        eventName: currentEvent,
        allowCreate: false,
        onPick: enrollPerson,
    });

    await loadAndDrawPeople();
    ims.hideLoadingOverlay();
    ims.enableEditing();
}

// loadEventOptions populates the event picker with the (non-group) events. Per-event
// fields (wristband, participation) only make sense for an actual fair, not a group.
async function loadEventOptions(): Promise<void> {
    const {json, err} = await ims.fetchNoThrow<ims.EventData[]>(url_events, null);
    if (err != null || json == null) {
        ims.setErrorMessage(`Failed to load events: ${err}`);
        return;
    }
    const events = json.sort((a, b) => a.name.localeCompare(b.name));
    el.eventName.querySelectorAll("option:not([value=''])").forEach(o => {o.remove()});
    for (const event of events) {
        const opt = document.createElement("option");
        opt.value = event.name;
        opt.textContent = event.name;
        el.eventName.append(opt);
    }
}

// The event the listing is scoped to ("" = none): drives the per-event badges and
// the per-event editor in the modals.
let currentEvent: string = "";
let people: ims.Personnel[]|null = null;
// With an event selected the listing defaults to that event's roster; this flips
// to listing every person (so anyone can be found and added). Off by default and
// only meaningful when an event is selected.
let showAllPeople: boolean = false;

async function changeEvent(): Promise<void> {
    currentEvent = el.eventName.value.trim();
    if (currentEvent) {
        localStorage.setItem(lastEventKey, currentEvent);
    } else {
        localStorage.removeItem(lastEventKey);
        // No event → there is no roster to scope to; reset the toggle.
        showAllPeople = false;
        el.showAllCheckbox.checked = false;
    }
    reflectEventSelection();
    await loadAndDrawPeople();
}

async function changeShowAll(): Promise<void> {
    showAllPeople = el.showAllCheckbox.checked;
    await loadAndDrawPeople();
}

// reflectEventSelection shows/hides the per-event editor blocks in both modals, the
// roster-only controls (the show-all toggle + the add-to-event picker), and labels
// them with the selected event.
function reflectEventSelection(): void {
    const hasEvent = currentEvent !== "";
    el.addPersonEventSection.classList.toggle("hidden", !hasEvent);
    el.editPersonEventSection.classList.toggle("hidden", !hasEvent);
    el.addPersonEventName.textContent = currentEvent;
    el.editPersonEventName.textContent = currentEvent;
    // "Show all people" lists everyone for the event (admin-only listing); a non-admin
    // inviter only ever sees the event roster, so the toggle stays hidden for them.
    el.showAllWrap.classList.toggle("hidden", !hasEvent || !isAdmin);
    // The search step's visibility is owned by setAddPersonStep (it's step 1 of the
    // Add-Person modal); here we only keep its event label in sync.
    el.addPersonSearchEvent.textContent = currentEvent;
}

async function loadAndDrawPeople(): Promise<void> {
    await loadPeople();
    drawPeople();
}

async function loadPeople(): Promise<{err:string|null}> {
    let url = url_personnel + "?all=true";
    if (currentEvent) {
        url += "&event=" + encodeURIComponent(currentEvent);
        // Default to the event roster; the toggle asks for everyone instead.
        if (showAllPeople) {
            url += "&showAll=true";
        }
    }
    const {json, err} = await ims.fetchNoThrow<ims.Personnel[]>(url, {
        headers: {"Cache-Control": "no-cache"},
    });
    if (err != null || json == null) {
        const message = "Failed to load people:\n" + err;
        console.error(message);
        ims.setErrorMessage(message);
        return {err: message};
    }
    json.sort((a: ims.Personnel, b: ims.Personnel): number =>
        ims.personDisplayLabel(a).localeCompare(ims.personDisplayLabel(b)));
    people = json;
    return {err: null};
}

function drawPeople(): void {
    el.peopleWithAccess.replaceChildren();
    el.peopleWithoutAccess.replaceChildren();

    const setPasswordModal = ims.bsModal(el.setPasswordModal);

    const all = people ?? [];
    // Split into people who can sign in to the IMS (a fair name/email set, or admin) and
    // name-only people tracked at the fair; sort each group by role (most access
    // first), then by name. Each is rendered as its own labelled section.
    const withAccess = all.filter(hasImsAccess).sort(comparePeopleByRole);
    const withoutAccess = all.filter((p: ims.Personnel): boolean => !hasImsAccess(p)).sort(comparePeopleByRole);

    renderPeopleSection(el.peopleWithAccess, "With IMS access", withAccess, setPasswordModal);
    renderPeopleSection(el.peopleWithoutAccess, "No access (name only)", withoutAccess, setPasswordModal);

    applyFilter();
}

// hasImsAccess reports whether a person can sign in — they have a fair name or email to
// authenticate with, or they're an admin. Name-only people (neither) are tracked at
// the fair but have no login.
function hasImsAccess(person: ims.Personnel): boolean {
    return Boolean(person.is_admin) || Boolean(person.fair_name?.trim()) || Boolean(person.email?.trim());
}

// Role ladder, most access first, used to sort each people group. Admins sort ahead
// of everyone; someone with no per-event role sorts last.
const roleSortOrder = ["writer", "crew_leader", "reporter", "volunteer", "public", "not_present", "ejected"];
function roleRank(person: ims.Personnel): number {
    if (person.is_admin) {
        return -1;
    }
    const idx = roleSortOrder.indexOf(person.participation_type ?? "");
    return idx === -1 ? roleSortOrder.length : idx;
}
function comparePeopleByRole(a: ims.Personnel, b: ims.Personnel): number {
    const byRole = roleRank(a) - roleRank(b);
    return byRole !== 0
        ? byRole
        : ims.personDisplayLabel(a).localeCompare(ims.personDisplayLabel(b));
}

// sectionHeaderRow builds the labelled divider row that introduces a people group.
function sectionHeaderRow(label: string, count: number): HTMLTableRowElement {
    const tr = document.createElement("tr");
    tr.classList.add("table-group-divider");
    const th = document.createElement("th");
    th.colSpan = 5;
    th.scope = "colgroup";
    th.classList.add("text-body-secondary", "small", "fw-semibold", "pt-3");
    th.textContent = `${label} (${count})`;
    tr.append(th);
    return tr;
}

// renderPeopleSection fills a tbody with a section-header row and a row per person.
// An empty group hides the whole tbody (header included).
function renderPeopleSection(
    tbody: HTMLTableSectionElement, label: string, group: ims.Personnel[],
    setPasswordModal: ReturnType<typeof ims.bsModal>,
): void {
    tbody.classList.toggle("hidden", group.length === 0);
    if (group.length === 0) {
        return;
    }
    tbody.append(sectionHeaderRow(label, group.length));
    for (const person of group) {
        tbody.append(buildPersonRow(person, setPasswordModal));
    }
}

// buildPersonRow clones the row template and fills it in for one person, returning
// the <tr> ready to append.
function buildPersonRow(
    person: ims.Personnel, setPasswordModal: ReturnType<typeof ims.bsModal>,
): HTMLTableRowElement {
        const entryItemFrag = el.personRowTemplate.content.cloneNode(true) as DocumentFragment;
        const entryItem = entryItemFrag.querySelector("tr")!;

        const label = ims.personDisplayLabel(person);
        entryItem.dataset["personId"] = (person.person_id ?? "").toString();
        // Lowercased haystack for the client-side search box.
        entryItem.dataset["search"] =
            `${label} ${person.fair_name ?? ""} ${person.wristband ?? ""}`.toLowerCase();

        entryItem.getElementsByClassName("person-name")[0]!.textContent = label;
        // Show the fair name as a secondary identifier only when it's distinct from the
        // primary label (i.e. the person has a legal name); fair-name-only people already
        // show their fair name as the label.
        entryItem.getElementsByClassName("person-handle")[0]!.textContent =
            (person.legal_name && person.fair_name) ? person.fair_name : "";

        // Admin badge next to the name. is_admin is only sent to admin viewers (53d),
        // so a non-admin inviter never sees it (and it stays hidden).
        if (person.is_admin) {
            entryItem.querySelector(".person-admin-badge")!.classList.remove("hidden");
        }

        const wristband: HTMLElement = entryItem.querySelector(".person-wristband")!;
        if (person.wristband) {
            wristband.textContent = person.wristband;
            wristband.classList.remove("hidden");
        }
        const participationWrap: HTMLElement = entryItem.querySelector(".person-participation-dropdown")!;
        const participationButton: HTMLButtonElement = entryItem.querySelector(".person-participation")!;
        const participationMenu: HTMLElement = entryItem.querySelector(".person-participation-menu")!;
        drawParticipationDropdown(person, participationWrap, participationButton, participationMenu);

        // Whether the viewer may manage this target's roster role / removal. Admins
        // may manage anyone; a non-admin inviter only a reporter-or-below target
        // (never a writer/crew_leader — the 53b ceiling, mirrored in the UI).
        const canManageTarget = isAdmin || (canInvite && !targetAboveInviterCeiling(person.participation_type));

        // Edit profile, reset an existing password, and toggle admin are all
        // admin-only (53d): a non-admin inviter sets only an *initial* password on
        // invite and never edits profiles or admin status.
        const showPassword: HTMLElement = entryItem.querySelector(".show-set-password-modal")!;
        const adminToggle: HTMLButtonElement = entryItem.querySelector(".toggle-admin")!;
        const showEdit: HTMLElement = entryItem.querySelector(".show-edit-modal")!;
        if (!isAdmin) {
            showPassword.classList.add("hidden");
            adminToggle.classList.add("hidden");
            showEdit.classList.add("hidden");
        } else {
            showEdit.addEventListener("click",
                function (_e: MouseEvent): void {
                    el.editPersonModal.dataset["personId"] = (person.person_id ?? "").toString();
                    el.editPersonHandle.value = person.fair_name ?? "";
                    el.editPersonName.value = person.legal_name ?? "";
                    el.editPersonEmail.value = person.email ?? "";
                    el.editPersonPhone.value = person.phone ?? "";
                    el.editPersonWristband.value = person.wristband ?? "";
                    el.editPersonParticipation.value = person.participation_type ?? "";
                    ims.bsModal(el.editPersonModal).show();
                },
            );
            if (!person.fair_name && !person.email) {
                // Login-only actions apply only to someone who can log in. Login is by
                // email OR fair name, so a registry person with neither (no way to sign
                // in) gets no password/admin controls.
                showPassword.classList.add("hidden");
                adminToggle.classList.add("hidden");
            } else {
                showPassword.addEventListener("click",
                    function (_e: MouseEvent): void {
                        el.setPasswordModal.dataset["personId"] = (person.person_id ?? "").toString();
                        el.setPasswordHandle.textContent = label;
                        el.setPasswordInput.value = "";
                        el.setPasswordConfirm.value = "";
                        setPasswordModal.show();
                    },
                );
                drawAdminToggle(adminToggle, person.is_admin ?? false);
                adminToggle.addEventListener("click",
                    function (_e: MouseEvent): void {
                        void toggleAdmin(person);
                    },
                );
            }
        }

        // "Remove from event" applies only to someone on the event roster (they have
        // a participation row), and only to a target the viewer may manage.
        const showRemove: HTMLElement = entryItem.querySelector(".show-remove-modal")!;
        if (currentEvent && person.participation_type && canManageTarget) {
            showRemove.classList.remove("hidden");
            entryItem.querySelector(".show-remove-divider")!.classList.remove("hidden");
            showRemove.addEventListener("click",
                function (_e: MouseEvent): void {
                    el.removeFromEventModal.dataset["personId"] = (person.person_id ?? "").toString();
                    // Carry the current wristband so an eject preserves it (the eject
                    // path upserts and would otherwise clear an omitted wristband).
                    el.removeFromEventModal.dataset["wristband"] = person.wristband ?? "";
                    el.removePersonLabel.textContent = label;
                    el.removeEventName.textContent = currentEvent;
                    ims.bsModal(el.removeFromEventModal).show();
                },
            );
        }

        // With no actions available to this viewer for this row, drop the empty kebab.
        if (entryItem.querySelectorAll(".person-actions .dropdown-item:not(.hidden)").length === 0) {
            entryItem.querySelector(".person-actions-toggle")!.classList.add("hidden");
        }

        return entryItem;
}

// filterPeople hides rows that don't match the search box, over the already-loaded
// admin listing (which, unlike the typeahead ?q= endpoint, includes inactive people
// and admin flags). See docs/plans/51-people-registry.md §4.3.
function filterPeople(): void {
    applyFilter();
}

function applyFilter(): void {
    const term = el.peopleSearch.value.trim().toLowerCase();
    // Only the data rows carry data-person-id; the section-header rows don't, so this
    // leaves the headers alone while filtering people across both groups.
    el.people.querySelectorAll<HTMLTableRowElement>("tbody tr[data-person-id]")
        .forEach((row: HTMLTableRowElement): void => {
            const hay = row.dataset["search"] ?? "";
            row.classList.toggle("hidden", term !== "" && !hay.includes(term));
        });
}

// drawParticipationDropdown turns the role badge into a one-click menu (slice 52e).
// The badge shows the person's current per-event role; opening it lists the standing
// rungs, and picking one writes immediately — no Edit-Person modal, no Save. It only
// appears for someone actually on this event's roster (a selected event + an existing
// participation row), mirroring the "Remove from event" button's visibility; people
// without a row (or with no event selected) still get a role via the Add/Edit modals.
function drawParticipationDropdown(
    person: ims.Personnel, wrap: HTMLElement, button: HTMLButtonElement, menu: HTMLElement,
): void {
    // Admins have unrestricted access to every event, so their per-event
    // participation role is meaningless here (6n) — show a static "admin" pill in
    // the Role column instead of the participation dropdown, regardless of whether
    // an event is selected. is_admin is only sent to admin viewers.
    if (person.is_admin) {
        wrap.classList.remove("hidden");
        button.textContent = "admin";
        button.className = "person-participation badge border-0 text-bg-dark";
        button.removeAttribute("data-bs-toggle");
        button.setAttribute("disabled", "true");
        button.setAttribute("aria-label", "Role: admin");
        menu.replaceChildren();
        return;
    }

    const type = person.participation_type;
    if (!currentEvent || !type) {
        wrap.classList.add("hidden");
        return;
    }
    wrap.classList.remove("hidden");

    // A non-admin inviter may change roles only on a reporter-or-below target (the
    // 53b ceiling). When they can't, the badge is shown but is a plain, non-clickable
    // label — no dropdown toggle, no menu.
    const editable = isAdmin || (canInvite && !targetAboveInviterCeiling(type));
    if (!editable) {
        button.textContent = type.replace("_", " ");
        button.className = `person-participation badge border-0 ${participationBadgeClass(type)}`;
        button.removeAttribute("data-bs-toggle");
        button.setAttribute("disabled", "true");
        button.setAttribute("aria-label", `Role: ${type.replace("_", " ")}`);
        menu.replaceChildren();
        return;
    }

    button.textContent = type.replace("_", " ");
    button.className = `person-participation badge dropdown-toggle border-0 ${participationBadgeClass(type)}`;
    button.setAttribute("aria-label", `Role: ${type.replace("_", " ")}. Change.`);

    menu.replaceChildren();
    for (const rung of roleRungsForPerson(person)) {
        const li = document.createElement("li");
        const item = document.createElement("button");
        item.type = "button";
        item.className = "dropdown-item d-flex justify-content-between align-items-center gap-3";
        if (rung.value === type) {
            item.classList.add("active");
            item.setAttribute("aria-current", "true");
        }
        const labelSpan = document.createElement("span");
        labelSpan.textContent = rung.label;
        const hintSpan = document.createElement("span");
        hintSpan.className = "small opacity-75";
        hintSpan.textContent = rung.hint;
        item.append(labelSpan, hintSpan);
        item.addEventListener("click", function (_e: MouseEvent): void {
            // No-op if it's already the current role (the active row).
            if (rung.value !== person.participation_type) {
                void setParticipationInline(person, rung.value);
            }
        });
        li.append(item);
        menu.append(li);
    }
}

// setParticipationInline writes a role change picked from the inline menu. It reuses
// the per-event participation endpoint (the same one the Add/Remove flows use),
// preserving the current wristband — an omitted wristband would be cleared by the
// upsert — then reloads so the badge color, ordering, and remove-button visibility
// all reflect the new role.
async function setParticipationInline(person: ims.Personnel, participation: string): Promise<void> {
    const personId = (person.person_id ?? "").toString();
    if (!personId || !currentEvent) {
        return;
    }
    const {err} = await ims.fetchNoThrow(participationUrl(personId), {
        body: JSON.stringify({
            "participation_type": participation,
            "wristband": person.wristband ?? "",
        }),
    });
    if (err != null) {
        const message = `Failed to update role:\n${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    ims.clearErrorMessage();
    await loadAndDrawPeople();
}

// drawAdminToggle labels the kebab's admin item by what clicking it does: "Remove
// admin" for a current admin, "Make admin" otherwise (the param is the person's
// current admin state).
function drawAdminToggle(button: HTMLButtonElement, isAdmin: boolean): void {
    button.textContent = isAdmin ? "Remove admin" : "Make admin";
    button.classList.toggle("text-danger", isAdmin);
    button.setAttribute("aria-pressed", isAdmin ? "true" : "false");
}

async function toggleAdmin(person: ims.Personnel): Promise<void> {
    const next = !(person.is_admin ?? false);
    const url = url_personnelAdmin.replace("<person_id>", encodeURIComponent((person.person_id ?? "").toString()));
    const {err} = await ims.fetchNoThrow(url, {
        body: JSON.stringify({"is_admin": next}),
    });
    if (err != null) {
        const message = `Failed to update admin flag:\n${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    ims.clearErrorMessage();
    // Reload so the whole row reflects the change: the admin badge next to the name,
    // the Role pill (a static "admin" pill vs. the participation badge), the kebab's
    // toggle label, and the admin-first sort. A button-only update left the badge and
    // pill stale (they're rendered once at row build from person.is_admin).
    await loadAndDrawPeople();
}

async function submitSetPassword(): Promise<void> {
    const personId = el.setPasswordModal.dataset["personId"];
    if (!personId) {
        return;
    }
    const password = el.setPasswordInput.value;
    const confirm = el.setPasswordConfirm.value;
    if (password.length < minPasswordLength) {
        ims.controlHasError(el.setPasswordInput);
        ims.setErrorMessage(`Password must be at least ${minPasswordLength} characters.`);
        return;
    }
    if (password !== confirm) {
        ims.controlHasError(el.setPasswordConfirm);
        ims.setErrorMessage("Passwords do not match.");
        return;
    }

    const url = url_personnelPassword.replace("<person_id>", encodeURIComponent(personId));
    const {err} = await ims.fetchNoThrow(url, {
        body: JSON.stringify({"password": password}),
    });
    if (err != null) {
        ims.controlHasError(el.setPasswordInput);
        const message = `Failed to set password:\n${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    ims.controlHasSuccess(el.setPasswordInput);
    ims.bsModal(el.setPasswordModal).hide();
}

function showAddPersonModal(): void {
    resetAddPersonForm();

    // Admins get the full Add-person form (all rungs, wristband). A non-admin inviter
    // gets the scoped "Invite reporter" form: identity + initial password, role fixed
    // to reporter — so the wristband + role pickers are hidden and a note explains it
    // (53d). The server enforces the same ceiling regardless of the UI.
    el.addPersonModalLabel.textContent = isAdmin ? "Add Person" : "Invite reporter";
    el.addPersonSubmit.textContent = isAdmin ? "Add person" : "Invite";
    el.addPersonWristbandWrap.classList.toggle("hidden", !isAdmin);
    el.addPersonParticipationWrap.classList.toggle("hidden", !isAdmin);
    el.addPersonInviteNote.classList.toggle("hidden", isAdmin);

    // Start by searching the registry when there's an event to add someone to; with no
    // event there's nothing to enrol into, so go straight to the create form.
    setAddPersonStep(currentEvent ? "search" : "create");

    ims.bsModal(el.addPersonModal).show();
}

// resetAddPersonForm clears every field and collapses the opt-in access section to its
// default (masked inputs; hidden for an admin, forced-open for an inviter).
function resetAddPersonForm(): void {
    el.addPersonSearch.value = "";
    el.addPersonName.value = "";
    el.addPersonHandle.value = "";
    el.addPersonEmail.value = "";
    el.addPersonPassword.value = "";
    el.addPersonPasswordConfirm.value = "";
    el.addPersonWristband.value = "";
    // Default a new event participant to "volunteer" (the common at-the-fair role).
    el.addPersonParticipation.value = "volunteer";
    resetPasswordToggle(el.addPersonPassword, el.addPersonPasswordToggle);
    resetPasswordToggle(el.addPersonPasswordConfirm, el.addPersonPasswordConfirmToggle);

    // Access (login) is opt-in for an admin — the button reveals the credential
    // fields. Inviting a reporter, though, exists to give login, so the section is
    // forced open and its toggle hidden in that flow.
    const forceAccess = !isAdmin;
    el.addPersonAccessToggle.classList.toggle("hidden", forceAccess);
    setAccessShown(forceAccess);
}

// setAddPersonStep switches the modal between searching the registry (step 1) and
// creating a brand-new person (step 2). The submit button and the Back link belong to
// the create step; Back only appears when search is actually an option (event picked).
function setAddPersonStep(step: "search" | "create"): void {
    const creating = step === "create";
    el.addPersonSearchSection.classList.toggle("hidden", creating);
    el.addPersonCreateSection.classList.toggle("hidden", !creating);
    el.addPersonSubmit.classList.toggle("hidden", !creating);
    el.addPersonBackToSearch.classList.toggle("hidden", !creating || currentEvent === "");
}

// showCreatePersonForm moves from the search step to the create form — invoked by the
// "Create a new person" button, so the redundant "search existing" UI is dropped once
// the user has decided they're adding someone new.
function showCreatePersonForm(): void {
    setAddPersonStep("create");
    el.addPersonName.focus();
}

function backToPersonSearch(): void {
    // Re-entering search → create should start from a clean form.
    resetAddPersonForm();
    setAddPersonStep("search");
    el.addPersonSearch.focus();
}

// resetPasswordToggle returns a password field + its Show/Hide button to the masked
// default — called whenever a modal is (re)opened.
function resetPasswordToggle(input: HTMLInputElement, button: HTMLButtonElement): void {
    input.type = "password";
    button.textContent = "Show";
}

// setAccessShown reveals or hides the "Provide Access to IMS" credential section and
// keeps the toggle button's label/state in sync.
function setAccessShown(shown: boolean): void {
    el.addPersonAccessSection.classList.toggle("hidden", !shown);
    el.addPersonAccessToggle.classList.toggle("active", shown);
    el.addPersonAccessToggle.textContent = shown ? "Don't provide IMS access" : "Provide Access to IMS";
    // With access on, email is a login credential: move it up next to the fair name
    // and relabel it required. With access off it's back to optional contact info
    // in its original spot (right after its home anchor).
    if (shown) {
        el.addPersonAccessSection.insertBefore(el.addPersonEmailWrap, el.addPersonHandle.parentElement);
        el.addPersonEmailLabel.textContent = "Email (required for login)";
    } else {
        el.addPersonEmailHome.after(el.addPersonEmailWrap);
        el.addPersonEmailLabel.textContent = "Email (optional)";
    }
}

function toggleProvideAccess(): void {
    const show = el.addPersonAccessSection.classList.contains("hidden"); // currently hidden -> reveal
    setAccessShown(show);
    if (show) {
        // Send them to whichever required login field still needs filling first.
        (el.addPersonEmail.value.trim() === "" ? el.addPersonEmail : el.addPersonHandle).focus();
    } else {
        // Collapsing discards any half-entered credentials so they aren't submitted.
        // Email is left alone — it's contact info, not a credential, and stays even
        // without access.
        el.addPersonHandle.value = "";
        el.addPersonPassword.value = "";
        el.addPersonPasswordConfirm.value = "";
        resetPasswordToggle(el.addPersonPassword, el.addPersonPasswordToggle);
        resetPasswordToggle(el.addPersonPasswordConfirm, el.addPersonPasswordConfirmToggle);
    }
}

async function submitCreatePerson(): Promise<void> {
    const name = el.addPersonName.value.trim();
    if (!name) {
        ims.controlHasError(el.addPersonName);
        ims.setErrorMessage("A full legal name is required.");
        return;
    }
    // Credentials are only collected (and required) when the access section is open.
    const wantAccess = !el.addPersonAccessSection.classList.contains("hidden");
    const handle = el.addPersonHandle.value.trim();
    const password = el.addPersonPassword.value;
    if (wantAccess) {
        if (!handle) {
            ims.controlHasError(el.addPersonHandle);
            ims.setErrorMessage("A fair name is required to provide IMS access.");
            return;
        }
        if (!el.addPersonEmail.value.trim()) {
            ims.controlHasError(el.addPersonEmail);
            ims.setErrorMessage("An email is required to provide IMS access.");
            return;
        }
        if (password.length < minPasswordLength) {
            ims.controlHasError(el.addPersonPassword);
            ims.setErrorMessage(`Password must be at least ${minPasswordLength} characters.`);
            return;
        }
        if (password !== el.addPersonPasswordConfirm.value) {
            ims.controlHasError(el.addPersonPasswordConfirm);
            ims.setErrorMessage("Passwords do not match.");
            return;
        }
    }

    const body: Record<string, unknown> = {
        "legal_name": name,
        "fair_name": wantAccess ? handle : "",
        // Email and phone are contact info, sent whether or not access is granted.
        "email": el.addPersonEmail.value.trim(),
        "phone": el.addPersonPhone.value.trim(),
        "password": wantAccess ? password : "",
    };
    if (currentEvent) {
        body["event"] = currentEvent;
        if (isAdmin) {
            body["wristband"] = el.addPersonWristband.value.trim();
            body["participation_type"] = el.addPersonParticipation.value;
        } else {
            // Invite flow: role is fixed to reporter (the server enforces this too).
            body["participation_type"] = "reporter";
        }
    }

    const {err} = await ims.fetchNoThrow(url_personnel, {
        body: JSON.stringify(body),
    });
    if (err != null) {
        ims.controlHasError(el.addPersonName);
        const message = `Failed to create person:\n${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    ims.bsModal(el.addPersonModal).hide();
    ims.clearErrorMessage();
    await loadAndDrawPeople();
}

async function submitEditPerson(): Promise<void> {
    const personId = el.editPersonModal.dataset["personId"];
    if (!personId) {
        return;
    }
    const body: Record<string, unknown> = {
        "fair_name": el.editPersonHandle.value.trim(),
        "legal_name": el.editPersonName.value.trim(),
        "email": el.editPersonEmail.value.trim(),
        "phone": el.editPersonPhone.value.trim(),
    };
    if (currentEvent) {
        body["event"] = currentEvent;
        body["wristband"] = el.editPersonWristband.value.trim();
        body["participation_type"] = el.editPersonParticipation.value;
    }

    const url = url_personnelEdit.replace("<person_id>", encodeURIComponent(personId));
    const {err} = await ims.fetchNoThrow(url, {
        body: JSON.stringify(body),
    });
    if (err != null) {
        const message = `Failed to edit person:\n${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    ims.bsModal(el.editPersonModal).hide();
    ims.clearErrorMessage();
    await loadAndDrawPeople();
}

// participationUrl builds the per-event participation endpoint for a person, with
// the event as a query param (the personnel API stays global, decorated per-event).
function participationUrl(personId: string): string {
    return url_personnelParticipation.replace("<person_id>", encodeURIComponent(personId))
        + "?event=" + encodeURIComponent(currentEvent);
}

// enrollPerson adds an existing registry person picked from the Add Person modal's
// search to the current event's roster, using the wristband + participation type
// entered in that modal. Backs the search-first half of the Add Person flow.
async function enrollPerson(person: ims.PersonSearchResult): Promise<void> {
    if (!currentEvent) {
        return;
    }
    const {err} = await ims.fetchNoThrow(participationUrl((person.person_id ?? "").toString()), {
        body: JSON.stringify({
            // Invite flow fixes the role to reporter; admins use the modal's picker.
            "participation_type": isAdmin ? el.addPersonParticipation.value : "reporter",
            "wristband": isAdmin ? el.addPersonWristband.value.trim() : "",
        }),
    });
    if (err != null) {
        const message = `Failed to add person to event:\n${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    ims.bsModal(el.addPersonModal).hide();
    ims.clearErrorMessage();
    await loadAndDrawPeople();
}

// submitMarkParticipation records a "kept" removal — not present or ejected — by
// upserting the participation type while preserving the current wristband. The row
// stays so the state is visible in the roster; who/when is captured by the action log.
async function submitMarkParticipation(participation: string): Promise<void> {
    const personId = el.removeFromEventModal.dataset["personId"];
    if (!personId || !currentEvent) {
        return;
    }
    const {err} = await ims.fetchNoThrow(participationUrl(personId), {
        body: JSON.stringify({
            "participation_type": participation,
            "wristband": el.removeFromEventModal.dataset["wristband"] ?? "",
        }),
    });
    if (err != null) {
        const message = `Failed to update participation:\n${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    ims.bsModal(el.removeFromEventModal).hide();
    ims.clearErrorMessage();
    await loadAndDrawPeople();
}

// submitRemoveFromEvent deletes the participation row entirely — the "added by
// mistake" removal. The global person and any incident/visit links are untouched.
async function submitRemoveFromEvent(): Promise<void> {
    const personId = el.removeFromEventModal.dataset["personId"];
    if (!personId || !currentEvent) {
        return;
    }
    const {err} = await ims.fetchNoThrow(participationUrl(personId), {method: "DELETE"});
    if (err != null) {
        const message = `Failed to remove from event:\n${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    ims.bsModal(el.removeFromEventModal).hide();
    ims.clearErrorMessage();
    await loadAndDrawPeople();
}
