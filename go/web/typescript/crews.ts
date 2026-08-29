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

import * as ims from "./ims.ts";

// crews.ts drives the event-scoped Crews admin page (feedback round 10, slice
// 10c). It lists an event's crews, lets an admin create/rename/delete them, and
// manages each crew's membership (add/remove a person, toggle a leader). The page
// is admin-only: the nav link, this page's gate, and the crews API all require
// GlobalAdministrateCrews.

type CrewMember = {
    person_id: number;
    handle?: string|null;
    name?: string|null;
    is_leader: boolean;
};

type Crew = {
    slug: string;
    name?: string|null;
    sort_order?: number|null;
    members?: CrewMember[]|null;
};

// CrewEdit is the POST body: an empty slug creates; otherwise delete, a member
// mutation, or a rename/reorder.
type CrewEdit = {
    slug?: string;
    name?: string;
    sort_order?: number;
    delete?: boolean;
    member?: {person_id: number; remove?: boolean; is_leader?: boolean};
};

declare global {
    interface Window {
        createCrew: () => void;
        renameCrew: (el: HTMLInputElement) => void;
        deleteCrew: (el: HTMLButtonElement) => void;
        removeMember: (el: HTMLButtonElement) => void;
        toggleLeader: (el: HTMLInputElement) => void;
    }
}

let currentEvent = "";
let crews: Crew[] = [];

const el = {
    addCrewContainer: ims.typedElement("add_crew_container", HTMLDivElement),
    addCrewName: ims.typedElement("add_crew_name", HTMLInputElement),
    crewsContainer: ims.typedElement("crews_container", HTMLDivElement),
    crews: ims.typedElement("crews", HTMLDivElement),
    crewTemplate: ims.typedElement("crew_template", HTMLTemplateElement),
    crewMemberTemplate: ims.typedElement("crew_member_template", HTMLTemplateElement),
};

initCrewsPage();

async function initCrewsPage(): Promise<void> {
    const init = await ims.commonPageInit();
    if (!init.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
    // Crews are admin-only end to end; a non-admin sees an access message, no controls.
    if (!init.authInfo.admin) {
        ims.setErrorMessage("You don't have permission to manage crews.");
        ims.hideLoadingOverlay();
        return;
    }
    currentEvent = ims.pathIds.eventName ?? "";

    window.createCrew = createCrew;
    window.renameCrew = renameCrew;
    window.deleteCrew = deleteCrew;
    window.removeMember = removeMember;
    window.toggleLeader = toggleLeader;

    el.addCrewContainer.classList.remove("hidden");
    el.crewsContainer.classList.remove("hidden");

    await loadAndDrawCrews();
    ims.hideLoadingOverlay();
    ims.enableEditing();
}

function crewsURL(): string {
    return ims.urlReplace(url_crews);
}

async function loadAndDrawCrews(): Promise<void> {
    const {json, err} = await ims.fetchNoThrow<Crew[]>(
        crewsURL(), {headers: {"Cache-Control": "no-cache"}},
    );
    if (err != null || json == null) {
        ims.setErrorMessage(`Failed to load crews: ${err}`);
        return;
    }
    crews = json;
    drawCrews();
}

function drawCrews(): void {
    el.crews.replaceChildren();
    for (const crew of crews) {
        el.crews.append(buildCrewCard(crew));
    }
}

function buildCrewCard(crew: Crew): DocumentFragment {
    const frag = el.crewTemplate.content.cloneNode(true) as DocumentFragment;
    const card = frag.querySelector(".crew-card") as HTMLElement;
    card.dataset["crewSlug"] = crew.slug;
    (card.querySelector(".crew-name") as HTMLInputElement).value = crew.name ?? "";

    const membersUl = card.querySelector(".crew-members") as HTMLElement;
    const members = crew.members ?? [];
    if (members.length === 0) {
        const li = document.createElement("li");
        li.className = "list-group-item text-body-secondary fst-italic";
        li.textContent = "No members yet.";
        membersUl.append(li);
    } else {
        for (const m of members) {
            membersUl.append(buildMemberRow(m));
        }
    }

    // A per-crew person combobox to add members, scoped to this event.
    const input = card.querySelector(".crew-add-member") as HTMLInputElement;
    const results = card.querySelector(".crew-add-member-results") as HTMLElement;
    ims.setupPersonCombobox({
        input: input,
        results: results,
        eventName: currentEvent,
        allowCreate: false,
        onPick: (person) => addMember(crew.slug, person.person_id ?? 0),
    });
    return frag;
}

function buildMemberRow(m: CrewMember): DocumentFragment {
    const frag = el.crewMemberTemplate.content.cloneNode(true) as DocumentFragment;
    const li = frag.querySelector(".crew-member") as HTMLElement;
    li.dataset["personId"] = String(m.person_id);
    (li.querySelector(".crew-member-name") as HTMLElement).textContent =
        ims.personDisplayLabel({handle: m.handle, name: m.name});
    (li.querySelector(".crew-member-leader") as HTMLInputElement).checked = m.is_leader;
    return frag;
}

// sendCrew POSTs one edit and, on success, reloads the whole list so the DOM
// reflects the server state (membership rebuilds are cheap on an admin page).
async function sendCrew(edit: CrewEdit): Promise<boolean> {
    const {err} = await ims.fetchNoThrow(crewsURL(), {body: JSON.stringify(edit)});
    if (err != null) {
        ims.setErrorMessage(`Crew update failed: ${err}`);
        return false;
    }
    await loadAndDrawCrews();
    return true;
}

function createCrew(): void {
    const name = el.addCrewName.value.trim();
    if (name === "") {
        return;
    }
    void sendCrew({name: name}).then((ok) => {
        if (ok) {
            el.addCrewName.value = "";
        }
    });
}

function renameCrew(input: HTMLInputElement): void {
    const slug = crewSlugOf(input);
    const name = input.value.trim();
    if (name === "") {
        ims.setErrorMessage("Crew name may not be blank.");
        return;
    }
    void sendCrew({slug: slug, name: name});
}

function deleteCrew(btn: HTMLButtonElement): void {
    const slug = crewSlugOf(btn);
    if (!window.confirm("Delete this crew? Its membership will be removed.")) {
        return;
    }
    void sendCrew({slug: slug, delete: true});
}

function addMember(slug: string, personID: number): void {
    if (personID <= 0) {
        return;
    }
    void sendCrew({slug: slug, member: {person_id: personID}});
}

function removeMember(btn: HTMLButtonElement): void {
    void sendCrew({slug: crewSlugOf(btn), member: {person_id: personIdOf(btn), remove: true}});
}

function toggleLeader(cb: HTMLInputElement): void {
    void sendCrew({slug: crewSlugOf(cb), member: {person_id: personIdOf(cb), is_leader: cb.checked}});
}

// crewSlugOf reads the enclosing crew card's slug from a control inside it.
function crewSlugOf(node: HTMLElement): string {
    const card = node.closest(".crew-card") as HTMLElement|null;
    return card?.dataset["crewSlug"] ?? "";
}

// personIdOf reads the enclosing member row's person id from a control inside it.
function personIdOf(node: HTMLElement): number {
    const li = node.closest(".crew-member") as HTMLElement|null;
    return ims.parseInt10(li?.dataset["personId"]) ?? 0;
}
