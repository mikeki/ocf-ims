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
        loadAreas: ()=>Promise<void>;
        showAddAreaModal: ()=>void;
        submitCreateArea: ()=>Promise<void>;
        setAreaName: (el: HTMLInputElement)=>Promise<void>;
        setAreaParent: (el: HTMLSelectElement)=>Promise<void>;
        setAreaSortOrder: (el: HTMLInputElement)=>Promise<void>;
    }
}

//
// Initialize UI
//

// Remembers the last event whose areas were viewed, so the page can reselect it
// and auto-load on the next visit.
const lastEventKey = "admin_areas_event";

const el = {
    eventName: ims.typedElement("event-name", HTMLSelectElement),
    areasContainer: ims.typedElement("areas_container", HTMLElement),
    areas: ims.typedElement("areas", HTMLElement),
    areaLiTemplate: ims.typedElement("area_li_template", HTMLTemplateElement),
    editAreaModal: ims.typedElement("editAreaModal", HTMLElement),
    editAreaName: ims.typedElement("edit_area_name", HTMLInputElement),
    editAreaParent: ims.typedElement("edit_area_parent", HTMLSelectElement),
    editAreaSortOrder: ims.typedElement("edit_area_sort_order", HTMLInputElement),
    addAreaModal: ims.typedElement("addAreaModal", HTMLElement),
    addAreaName: ims.typedElement("add_area_name", HTMLInputElement),
    addAreaParent: ims.typedElement("add_area_parent", HTMLSelectElement),
    addAreaSortOrder: ims.typedElement("add_area_sort_order", HTMLInputElement),
};

initAdminAreasPage();

async function initAdminAreasPage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }

    window.loadAreas = loadAreas;
    window.showAddAreaModal = showAddAreaModal;
    window.submitCreateArea = submitCreateArea;
    window.setAreaName = setAreaName;
    window.setAreaParent = setAreaParent;
    window.setAreaSortOrder = setAreaSortOrder;

    await loadEventOptions();

    // The page serves two doorways, mirroring People (plan 62, 6o):
    //   - event doorway  (/ims/app/events/{event}/areas): pinned to the URL event;
    //     the picker is locked to it.
    //   - admin doorway  (/ims/app/admin/areas): no URL event, the user picks one
    //     (remembered in localStorage).
    const urlEvent: string|null = ims.pathIds.eventName;
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
        await loadAreas();
    } else {
        // Admin doorway: reselect the last-viewed event and load it automatically.
        const lastEvent = localStorage.getItem(lastEventKey);
        if (lastEvent && [...el.eventName.options].some(o => o.value === lastEvent)) {
            el.eventName.value = lastEvent;
            await loadAreas();
        }
    }

    ims.hideLoadingOverlay();
    ims.enableEditing();
}

// loadEventOptions populates the event picker with the (non-group) events. Areas
// are per-event, and only non-group events can hold areas/incidents.
async function loadEventOptions(): Promise<void> {
    const {json, err} = await ims.fetchNoThrow<ims.EventData[]>(url_events, null);
    if (err != null || json == null) {
        ims.setErrorMessage(`Failed to load events: ${err}`);
        return;
    }
    const events = json.sort((a, b) => a.name.localeCompare(b.name));
    // Keep the leading placeholder option; replace the rest.
    el.eventName.querySelectorAll("option:not([value=''])").forEach(o => {o.remove()});
    for (const event of events) {
        const opt = document.createElement("option");
        opt.value = event.name;
        opt.textContent = event.name;
        el.eventName.append(opt);
    }
}

// The event whose areas are currently loaded; the area API is per-event.
let currentEvent: string = "";
let adminAreas: ims.Area[] = [];

function areasURL(): string {
    return url_areas.replace("<event_id>", currentEvent);
}

async function loadAreas(): Promise<void> {
    ims.clearErrorMessage();
    currentEvent = el.eventName.value.trim();
    // The areas table (and its New-area button) only make sense once an event is
    // chosen, so keep the whole card hidden until then.
    el.areasContainer.classList.toggle("hidden", !currentEvent);
    if (!currentEvent) {
        adminAreas = [];
        drawAreas();
        return;
    }
    localStorage.setItem(lastEventKey, currentEvent);

    const {json, err} = await ims.fetchNoThrow<ims.Areas>(areasURL(), {
        headers: {"Cache-Control": "no-cache"},
    });
    if (err != null || json == null) {
        const message = `Failed to load areas: ${err}`;
        console.error(message);
        ims.setErrorMessage(message);
        return;
    }
    adminAreas = json;
    drawAreas();
}

// compareAreas orders areas by sort_order, then by name.
function compareAreas(a: ims.Area, b: ims.Area): number {
    const diff = (a.sort_order??0) - (b.sort_order??0);
    if (diff !== 0) {
        return diff;
    }
    return (a.name??"").localeCompare(b.name??"");
}

function drawAreas(): void {
    const container = el.areas.querySelector("ul")!;
    container.querySelectorAll("li").forEach(li => {li.remove()});

    const editAreaModal = ims.bsModal(el.editAreaModal);

    // Render top-level areas in sort order, each immediately followed by its
    // children (single-level hierarchy), children indented.
    const topLevel = adminAreas.filter(a => !a.parent_slug).sort(compareAreas);
    for (const area of topLevel) {
        appendAreaRow(container, area, false, editAreaModal);
        const children = adminAreas
            .filter(a => a.parent_slug === area.slug)
            .sort(compareAreas);
        for (const child of children) {
            appendAreaRow(container, child, true, editAreaModal);
        }
    }
}

function appendAreaRow(
    container: HTMLElement, area: ims.Area, indent: boolean, editAreaModal: any,
): void {
    const frag = el.areaLiTemplate.content.cloneNode(true) as DocumentFragment;
    const li = frag.querySelector("li")!;
    if (indent) {
        li.classList.add("ms-4");
    }
    li.dataset["areaSlug"] = area.slug??"";

    li.getElementsByClassName("area-name")[0]!.textContent = area.name??"";
    li.getElementsByClassName("area-slug")[0]!.textContent = area.slug??"";

    const showEditModal: HTMLElement = li.querySelector(".show-edit-modal")!;
    showEditModal.addEventListener("click", (_e: MouseEvent): void => {
        el.editAreaModal.dataset["areaSlug"] = area.slug??"";
        el.editAreaName.value = area.name??"";
        el.editAreaSortOrder.value = (area.sort_order??0).toString();
        populateParentOptions(area);
        editAreaModal.show();
    });

    container.append(frag);
}

// populateParentOptions fills the parent <select> with the event's top-level
// areas, excluding the area being edited (single-level hierarchy means a child
// can never be chosen as a parent).
function populateParentOptions(editing: ims.Area): void {
    const select = el.editAreaParent;
    select.querySelectorAll("option:not([value=''])").forEach(o => {o.remove()});
    const candidates = adminAreas
        .filter(a => !a.parent_slug && a.slug !== editing.slug)
        .sort(compareAreas);
    for (const a of candidates) {
        const opt = document.createElement("option");
        opt.value = a.slug??"";
        opt.textContent = a.name??"";
        select.append(opt);
    }
    select.value = editing.parent_slug??"";
}

// showAddAreaModal opens the New-area modal, prefilled with the event's top-level
// areas as parent options. The button is only visible once an event is selected.
function showAddAreaModal(): void {
    if (!currentEvent) {
        return;
    }
    el.addAreaName.value = "";
    el.addAreaSortOrder.value = "0";
    populateAddParentOptions();
    ims.bsModal(el.addAreaModal).show();
}

// populateAddParentOptions fills the New-area modal's parent <select> with the
// event's top-level areas (single-level hierarchy, so children can't be parents).
function populateAddParentOptions(): void {
    const select = el.addAreaParent;
    select.querySelectorAll("option:not([value=''])").forEach(o => {o.remove()});
    const candidates = adminAreas.filter(a => !a.parent_slug).sort(compareAreas);
    for (const a of candidates) {
        const opt = document.createElement("option");
        opt.value = a.slug??"";
        opt.textContent = a.name??"";
        select.append(opt);
    }
    select.value = "";
}

async function submitCreateArea(): Promise<void> {
    if (!currentEvent) {
        return;
    }
    const name = el.addAreaName.value.trim();
    if (!name) {
        ims.controlHasError(el.addAreaName);
        ims.setErrorMessage("Area name is required.");
        return;
    }
    const {err} = await sendArea({
        name: name,
        parent_slug: el.addAreaParent.value,
        sort_order: ims.parseInt10(el.addAreaSortOrder.value)??0,
    });
    if (err != null) {
        ims.controlHasError(el.addAreaName);
        return;
    }
    ims.bsModal(el.addAreaModal).hide();
    await loadAreas();
}

async function setAreaName(sender: HTMLInputElement): Promise<void> {
    const slug = el.editAreaModal.dataset["areaSlug"];
    if (!slug || !sender.value) {
        return;
    }
    const {err} = await sendArea({slug: slug, name: sender.value});
    reflectControlResult(sender, err);
    await loadAreas();
}

async function setAreaParent(sender: HTMLSelectElement): Promise<void> {
    const slug = el.editAreaModal.dataset["areaSlug"];
    if (!slug) {
        return;
    }
    // Send the raw value: "" sets the area to top-level.
    const {err} = await sendArea({slug: slug, parent_slug: sender.value});
    reflectControlResult(sender, err);
    await loadAreas();
}

async function setAreaSortOrder(sender: HTMLInputElement): Promise<void> {
    const slug = el.editAreaModal.dataset["areaSlug"];
    if (!slug) {
        return;
    }
    const {err} = await sendArea({slug: slug, sort_order: ims.parseInt10(sender.value)??0});
    reflectControlResult(sender, err);
    await loadAreas();
}

function reflectControlResult(sender: HTMLElement, err: string|null): void {
    if (err != null) {
        ims.controlHasError(sender);
        return;
    }
    ims.controlHasSuccess(sender);
}

async function sendArea(edits: ims.Area): Promise<{err:string|null}> {
    const {err} = await ims.fetchNoThrow(areasURL(), {
        body: JSON.stringify(edits),
    });
    if (err == null) {
        return {err: null};
    }
    const message = `Failed to edit area:\n${JSON.stringify(err)}`;
    console.log(message);
    ims.setErrorMessage(message);
    return {err: err};
}
