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
        submitCreatePerson: ()=>Promise<void>;
        submitEditPerson: ()=>Promise<void>;
        submitMarkParticipation: (participation: string)=>Promise<void>;
        submitRemoveFromEvent: ()=>Promise<void>;
    }
}

const minPasswordLength = 8;

// Remembers the last event the People page was scoped to, so per-event wristband
// and participation are shown (and editable) again on the next visit.
const lastEventKey = "admin_people_event";

const el = {
    eventName: ims.typedElement("event-name", HTMLSelectElement),
    peopleSearch: ims.typedElement("people-search", HTMLInputElement),
    people: ims.typedElement("people", HTMLElement),
    personLiTemplate: ims.typedElement("person_li_template", HTMLTemplateElement),
    setPasswordModal: ims.typedElement("setPasswordModal", HTMLElement),
    setPasswordHandle: ims.typedElement("set_password_handle", HTMLElement),
    setPasswordInput: ims.typedElement("set_password_input", HTMLInputElement),
    setPasswordConfirm: ims.typedElement("set_password_confirm", HTMLInputElement),
    addPersonModal: ims.typedElement("addPersonModal", HTMLElement),
    addPersonName: ims.typedElement("add_person_name", HTMLInputElement),
    addPersonHandle: ims.typedElement("add_person_handle", HTMLInputElement),
    addPersonEmail: ims.typedElement("add_person_email", HTMLInputElement),
    addPersonPassword: ims.typedElement("add_person_password", HTMLInputElement),
    addPersonEventSection: ims.typedElement("add_person_event_section", HTMLElement),
    addPersonEventName: ims.typedElement("add_person_event_name", HTMLElement),
    addPersonWristband: ims.typedElement("add_person_wristband", HTMLInputElement),
    addPersonParticipation: ims.typedElement("add_person_participation", HTMLSelectElement),
    editPersonModal: ims.typedElement("editPersonModal", HTMLElement),
    editPersonHandle: ims.typedElement("edit_person_handle", HTMLElement),
    editPersonName: ims.typedElement("edit_person_name", HTMLInputElement),
    editPersonEmail: ims.typedElement("edit_person_email", HTMLInputElement),
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
    if (!initResult.authInfo.canManagePersonnel) {
        ims.setErrorMessage("You do not have permission to manage people.");
        ims.hideLoadingOverlay();
        return;
    }

    window.changeEvent = changeEvent;
    window.changeShowAll = changeShowAll;
    window.filterPeople = filterPeople;
    window.submitSetPassword = submitSetPassword;
    window.showAddPersonModal = showAddPersonModal;
    window.submitCreatePerson = submitCreatePerson;
    window.submitEditPerson = submitEditPerson;
    window.submitMarkParticipation = submitMarkParticipation;
    window.submitRemoveFromEvent = submitRemoveFromEvent;

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
        el.eventName.disabled = true;
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
    el.showAllWrap.classList.toggle("hidden", !hasEvent);
    // The "add an existing person" search only makes sense with an event to add to.
    el.addPersonSearchSection.classList.toggle("hidden", !hasEvent);
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
    const container = el.people.querySelector("ul")!;
    container.querySelectorAll("li").forEach(entry => {entry.remove()});

    const setPasswordModal = ims.bsModal(el.setPasswordModal);

    for (const person of people??[]) {
        const entryItemFrag = el.personLiTemplate.content.cloneNode(true) as DocumentFragment;
        const entryItem = entryItemFrag.querySelector("li")!;

        const label = ims.personDisplayLabel(person);
        entryItem.dataset["personId"] = (person.person_id ?? "").toString();
        // Lowercased haystack for the client-side search box.
        entryItem.dataset["search"] =
            `${label} ${person.handle ?? ""} ${person.wristband ?? ""}`.toLowerCase();

        entryItem.getElementsByClassName("person-name")[0]!.textContent = label;
        // Show the handle as a secondary identifier only when it's distinct from the
        // primary label (i.e. the person has a name); handle-only people already show
        // their handle as the label.
        entryItem.getElementsByClassName("person-handle")[0]!.textContent =
            (person.name && person.handle) ? person.handle : "";

        const wristband: HTMLElement = entryItem.querySelector(".person-wristband")!;
        if (person.wristband) {
            wristband.textContent = person.wristband;
            wristband.classList.remove("hidden");
        }
        const participation: HTMLElement = entryItem.querySelector(".person-participation")!;
        if (person.participation_type) {
            participation.textContent = person.participation_type.replace("_", " ");
            participation.classList.remove("hidden");
            // Draw attention to the kept-but-inactive states (slice 6j).
            if (person.participation_type === "ejected") {
                participation.classList.replace("text-bg-light", "text-bg-warning");
            } else if (person.participation_type === "not_present") {
                participation.classList.replace("text-bg-light", "text-bg-secondary");
            }
        }

        const showPassword: HTMLElement = entryItem.querySelector(".show-set-password-modal")!;
        const adminToggle: HTMLButtonElement = entryItem.querySelector(".toggle-admin")!;
        if (!person.handle) {
            // Login-only actions don't apply to a handle-less registry person.
            showPassword.classList.add("hidden");
            adminToggle.classList.add("hidden");
        } else {
            showPassword.addEventListener("click",
                function (_e: MouseEvent): void {
                    el.setPasswordModal.dataset["personId"] = (person.person_id ?? "").toString();
                    el.setPasswordHandle.textContent = person.handle;
                    el.setPasswordInput.value = "";
                    el.setPasswordConfirm.value = "";
                    setPasswordModal.show();
                },
            );
            drawAdminToggle(adminToggle, person.is_admin ?? false);
            adminToggle.addEventListener("click",
                function (_e: MouseEvent): void {
                    void toggleAdmin(person, adminToggle);
                },
            );
        }

        const showEdit: HTMLElement = entryItem.querySelector(".show-edit-modal")!;
        showEdit.addEventListener("click",
            function (_e: MouseEvent): void {
                el.editPersonModal.dataset["personId"] = (person.person_id ?? "").toString();
                el.editPersonHandle.textContent = label;
                el.editPersonName.value = person.name ?? "";
                el.editPersonEmail.value = person.email ?? "";
                el.editPersonWristband.value = person.wristband ?? "";
                el.editPersonParticipation.value = person.participation_type ?? "";
                ims.bsModal(el.editPersonModal).show();
            },
        );

        // "Remove from event" applies only to someone on the event roster (they have
        // a participation row), so it's shown only with an event selected and a type.
        const showRemove: HTMLElement = entryItem.querySelector(".show-remove-modal")!;
        if (currentEvent && person.participation_type) {
            showRemove.classList.remove("hidden");
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

        container.append(entryItemFrag);
    }
    applyFilter();
}

// filterPeople hides rows that don't match the search box, over the already-loaded
// admin listing (which, unlike the typeahead ?q= endpoint, includes inactive people
// and admin flags). See docs/plans/51-people-registry.md §4.3.
function filterPeople(): void {
    applyFilter();
}

function applyFilter(): void {
    const term = el.peopleSearch.value.trim().toLowerCase();
    const container = el.people.querySelector("ul")!;
    container.querySelectorAll("li").forEach((li: HTMLLIElement): void => {
        const hay = li.dataset["search"] ?? "";
        li.classList.toggle("hidden", term !== "" && !hay.includes(term));
    });
}

function drawAdminToggle(button: HTMLButtonElement, isAdmin: boolean): void {
    button.textContent = isAdmin ? "Admin ✓" : "Admin";
    button.classList.toggle("btn-warning", isAdmin);
    button.classList.toggle("btn-outline-secondary", !isAdmin);
    button.setAttribute("aria-pressed", isAdmin ? "true" : "false");
}

async function toggleAdmin(person: ims.Personnel, button: HTMLButtonElement): Promise<void> {
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
    person.is_admin = next;
    drawAdminToggle(button, next);
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
    el.addPersonSearch.value = "";
    el.addPersonName.value = "";
    el.addPersonHandle.value = "";
    el.addPersonEmail.value = "";
    el.addPersonPassword.value = "";
    el.addPersonWristband.value = "";
    el.addPersonParticipation.value = "";
    ims.bsModal(el.addPersonModal).show();
}

async function submitCreatePerson(): Promise<void> {
    const name = el.addPersonName.value.trim();
    const handle = el.addPersonHandle.value.trim();
    if (!name && !handle) {
        ims.controlHasError(el.addPersonName);
        ims.setErrorMessage("A name or handle is required.");
        return;
    }
    const password = el.addPersonPassword.value;
    if (password !== "" && password.length < minPasswordLength) {
        ims.controlHasError(el.addPersonPassword);
        ims.setErrorMessage(`Password must be at least ${minPasswordLength} characters (or left blank).`);
        return;
    }

    const body: Record<string, unknown> = {
        "name": name,
        "handle": handle,
        "email": el.addPersonEmail.value.trim(),
        "password": password,
    };
    if (currentEvent) {
        body["event"] = currentEvent;
        body["wristband"] = el.addPersonWristband.value.trim();
        body["participation_type"] = el.addPersonParticipation.value;
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
        "name": el.editPersonName.value.trim(),
        "email": el.editPersonEmail.value.trim(),
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
            "participation_type": el.addPersonParticipation.value,
            "wristband": el.addPersonWristband.value.trim(),
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
