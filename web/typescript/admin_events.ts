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
        submitCreateEvent: ()=>Promise<void>;
    }
}

// Event names appear in IMS URLs and in filesystem paths, so keep them simple.
// This mirrors the server's allowedEventNames pattern (api/event.go).
const eventNamePattern = /^[\w-]+$/;

const el = {
    addEventName: ims.typedElement("add_event_name", HTMLInputElement),
    addEventSubmit: ims.typedElement("add_event_submit", HTMLButtonElement),
    eventsList: ims.typedElement("events_list", HTMLUListElement),
    eventLiTemplate: ims.typedElement("event_li_template", HTMLTemplateElement),
};

initAdminEventsPage();

async function initAdminEventsPage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
    // Creating events requires GlobalAdministrateEvents, which only admins hold.
    // The API enforces this too; gate the UI so a non-admin sees why rather than
    // hitting a silent 403 on submit.
    if (!initResult.authInfo.admin) {
        ims.setErrorMessage("You must be an administrator to manage events.");
        ims.hideLoadingOverlay();
        return;
    }

    window.submitCreateEvent = submitCreateEvent;

    // Enter in the name field submits, matching the button.
    el.addEventName.addEventListener("keydown", (e: KeyboardEvent): void => {
        if (e.key === "Enter") {
            e.preventDefault();
            void submitCreateEvent();
        }
    });

    await loadEvents();

    ims.hideLoadingOverlay();
    ims.enableEditing();
}

// loadEvents fetches every event (groups included, so the admin sees the full
// set) and redraws the list.
async function loadEvents(): Promise<void> {
    const {json, err} = await ims.fetchNoThrow<ims.EventData[]>(
        url_events + "?include_groups=true", null,
    );
    if (err != null || json == null) {
        ims.setErrorMessage(`Failed to load events: ${err}`);
        return;
    }
    const events = json.slice().sort((a, b) => a.name.localeCompare(b.name));
    drawEvents(events);
}

function drawEvents(events: ims.EventData[]): void {
    el.eventsList.querySelectorAll("li").forEach(li => {li.remove()});
    if (events.length === 0) {
        const li = document.createElement("li");
        li.classList.add("list-group-item", "ps-3", "text-body-secondary");
        li.textContent = "No events yet.";
        el.eventsList.append(li);
        return;
    }
    for (const event of events) {
        const frag = el.eventLiTemplate.content.cloneNode(true) as DocumentFragment;
        const li = frag.querySelector("li")!;
        li.getElementsByClassName("event-name")[0]!.textContent = event.name;
        const link = li.querySelector(".event-link") as HTMLAnchorElement;
        if (event.is_group) {
            // Groups are containers, not navigable event pages.
            li.getElementsByClassName("event-group")[0]!.classList.remove("hidden");
            link.classList.add("hidden");
        } else {
            link.href = url_viewIncidents.replace("<event_id>", encodeURIComponent(event.name));
        }
        el.eventsList.append(frag);
    }
}

async function submitCreateEvent(): Promise<void> {
    const name = el.addEventName.value.trim();
    if (!name) {
        ims.controlHasError(el.addEventName);
        ims.setErrorMessage("Event name is required.");
        return;
    }
    if (!eventNamePattern.test(name)) {
        ims.controlHasError(el.addEventName);
        ims.setErrorMessage(
            "Event names may contain only letters, numbers, underscores, and hyphens (no spaces).");
        return;
    }
    ims.clearErrorMessage();
    el.addEventSubmit.disabled = true;
    const {err} = await ims.fetchNoThrow(url_events, {
        body: JSON.stringify({name: name}),
    });
    el.addEventSubmit.disabled = false;
    if (err != null) {
        ims.controlHasError(el.addEventName);
        ims.setErrorMessage(`Failed to create event: ${err}`);
        return;
    }
    ims.controlHasSuccess(el.addEventName);
    el.addEventName.value = "";
    await loadEvents();
    el.addEventName.focus();
}
