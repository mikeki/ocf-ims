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
        createOutcome: (el: HTMLInputElement)=>Promise<void>;
        showOutcome: (el: HTMLElement)=>Promise<void>;
        hideOutcome: (el: HTMLElement)=>Promise<void>;
        setOutcomeName: (el: HTMLInputElement)=>Promise<void>;
    }
}

//
// Initialize UI
//

const el = {
    outcomes: ims.typedElement("outcomes", HTMLElement),
    outcomeLiTemplate: ims.typedElement("outcome_li_template", HTMLTemplateElement),
    editOutcomeModal: ims.typedElement("editOutcomeModal", HTMLElement),
    editOutcomeName: ims.typedElement("edit_outcome_name", HTMLInputElement),
};

initAdminOutcomesPage();

async function initAdminOutcomesPage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }

    window.createOutcome = createOutcome;
    window.showOutcome = showOutcome;
    window.hideOutcome = hideOutcome;
    window.setOutcomeName = setOutcomeName;

    await loadAndDrawOutcomes();
    ims.hideLoadingOverlay();
    ims.enableEditing();
}


async function loadAndDrawOutcomes(): Promise<void> {
    await loadAllOutcomes();
    drawAllOutcomes();
}


let adminOutcomes: ims.Outcome[]|null = null;

async function loadAllOutcomes(): Promise<{err:string|null}> {
    const {json, err} = await ims.fetchNoThrow<ims.Outcome[]>(url_outcomes, {
        headers: {"Cache-Control": "no-cache"},
    });
    if (err != null || json == null) {
        const message = "Failed to load outcomes:\n" + err;
        console.error(message);
        window.alert(message);
        return {err: message};
    }
    json.sort((a: ims.Outcome, b: ims.Outcome): number => (a.name??"").localeCompare(b.name??""));
    adminOutcomes = json;
    return {err: null};
}


function drawAllOutcomes(): void {
    const entryContainer = el.outcomes.querySelector("ul")!;
    entryContainer.querySelectorAll("li")!.forEach(entry => {entry.remove()});

    const editOutcomeModal = ims.bsModal(el.editOutcomeModal);

    for (const outcome of adminOutcomes??[]) {
        const entryItemFrag = el.outcomeLiTemplate.content.cloneNode(true) as DocumentFragment;
        const entryItem = entryItemFrag.querySelector("li")!;

        if (outcome.hidden) {
            entryItem.classList.add("item-hidden");
        } else {
            entryItem.classList.add("item-visible");
        }

        const nameSpan = entryItem.getElementsByClassName("outcome-name-text")[0]!;
        nameSpan.textContent = outcome.name??null;

        entryItem.dataset["outcomeId"] = outcome.id?.toString();

        // A still-unapproved outcome is a writer's proposal: flag it and offer the
        // admin an Approve button.
        if (outcome.approved === false) {
            const proposed: HTMLElement = entryItem.querySelector(".outcome-proposed")!;
            proposed.classList.remove("hidden");
            const who = outcome.proposer?.handle || outcome.proposer?.name;
            if (who) {
                proposed.title = `Proposed by ${who}`;
            }
            const approveBtn: HTMLElement = entryItem.querySelector(".approve-outcome")!;
            approveBtn.classList.remove("hidden");
            approveBtn.addEventListener("click", () => approveOutcome(outcome.id ?? null));
        }

        const showEditModal: HTMLElement = entryItem.querySelector(".show-edit-modal")!;
        showEditModal.addEventListener("click",
            function (_e: MouseEvent): void  {
                el.editOutcomeModal.dataset["outcomeId"] = outcome.id?.toString();
                el.editOutcomeName.value = outcome.name??"";
                editOutcomeModal.show();
            },
        );

        entryContainer.append(entryItemFrag);
    }
}


async function createOutcome(sender: HTMLInputElement): Promise<void> {
    const {err} = await sendOutcomes({"name": sender.value});
    if (err == null) {
        sender.value = "";
    }
    await loadAndDrawOutcomes();
}


// approveOutcome promotes a writer's proposed outcome to an approved one.
async function approveOutcome(id: number|null): Promise<void> {
    if (id == null) {
        return;
    }
    const {err} = await sendOutcomes({"id": id, "approved": true});
    if (err != null) {
        return;
    }
    await loadAndDrawOutcomes();
}


async function showOutcome(sender: HTMLElement): Promise<void> {
    const outcomeId = sender.closest("li")?.dataset["outcomeId"];
    if (!outcomeId) {
        return;
    }
    await sendOutcomes({
        "id": ims.parseInt10(outcomeId),
        "hidden": false,
    });
    await loadAndDrawOutcomes();
}


async function hideOutcome(sender: HTMLElement): Promise<void> {
    const outcomeId = sender.closest("li")?.dataset["outcomeId"];
    if (!outcomeId) {
        return;
    }
    await sendOutcomes({
        "id": ims.parseInt10(outcomeId),
        "hidden": true,
    });
    await loadAndDrawOutcomes();
}

async function setOutcomeName(sender: HTMLInputElement): Promise<void> {
    const id = ims.parseInt10(el.editOutcomeModal.dataset["outcomeId"]);
    if (id == null || !sender.value) {
        return;
    }
    const {err} = await sendOutcomes({
        "id": id,
        "name": sender.value,
    });
    if (err != null) {
        ims.controlHasError(sender);
        return;
    }
    ims.controlHasSuccess(sender);
    await loadAndDrawOutcomes();
}

async function sendOutcomes(edits: ims.Outcome): Promise<{err:string|null}> {
    const {err} = await ims.fetchNoThrow(url_outcomes, {
        body: JSON.stringify(edits),
    });
    if (err == null) {
        return {err: null};
    }
    const message = `Failed to edit outcomes:\n${JSON.stringify(err)}`;
    console.log(message);
    window.alert(message);
    return {err: err};
}
