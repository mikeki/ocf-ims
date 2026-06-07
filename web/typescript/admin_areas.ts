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
        createArea: (el: HTMLInputElement)=>Promise<void>;
        setAreaName: (el: HTMLInputElement)=>Promise<void>;
        setAreaParent: (el: HTMLSelectElement)=>Promise<void>;
        setAreaSortOrder: (el: HTMLInputElement)=>Promise<void>;
    }
}

//
// Initialize UI
//

const el = {
    eventName: ims.typedElement("event-name", HTMLInputElement),
    areas: ims.typedElement("areas", HTMLElement),
    areaLiTemplate: ims.typedElement("area_li_template", HTMLTemplateElement),
    editAreaModal: ims.typedElement("editAreaModal", HTMLElement),
    editAreaName: ims.typedElement("edit_area_name", HTMLInputElement),
    editAreaParent: ims.typedElement("edit_area_parent", HTMLSelectElement),
    editAreaSortOrder: ims.typedElement("edit_area_sort_order", HTMLInputElement),
};

initAdminAreasPage();

async function initAdminAreasPage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }

    window.loadAreas = loadAreas;
    window.createArea = createArea;
    window.setAreaName = setAreaName;
    window.setAreaParent = setAreaParent;
    window.setAreaSortOrder = setAreaSortOrder;

    ims.hideLoadingOverlay();
    ims.enableEditing();
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
    if (!currentEvent) {
        adminAreas = [];
        drawAreas();
        return;
    }

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

async function createArea(sender: HTMLInputElement): Promise<void> {
    if (!currentEvent) {
        ims.setErrorMessage("Enter an event name before adding areas.");
        return;
    }
    const {err} = await sendArea({name: sender.value});
    if (err == null) {
        sender.value = "";
    }
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
