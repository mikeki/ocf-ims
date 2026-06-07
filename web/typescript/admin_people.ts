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
        submitSetPassword: ()=>Promise<void>;
    }
}

const minPasswordLength = 8;

const el = {
    people: ims.typedElement("people", HTMLElement),
    personLiTemplate: ims.typedElement("person_li_template", HTMLTemplateElement),
    setPasswordModal: ims.typedElement("setPasswordModal", HTMLElement),
    setPasswordHandle: ims.typedElement("set_password_handle", HTMLElement),
    setPasswordInput: ims.typedElement("set_password_input", HTMLInputElement),
    setPasswordConfirm: ims.typedElement("set_password_confirm", HTMLInputElement),
};

initAdminPeoplePage();

async function initAdminPeoplePage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
    if (!initResult.authInfo.canManagePersonnel) {
        ims.setErrorMessage("You do not have permission to manage people.");
        ims.hideLoadingOverlay();
        return;
    }

    window.submitSetPassword = submitSetPassword;

    await loadAndDrawPeople();
    ims.hideLoadingOverlay();
    ims.enableEditing();
}


let people: ims.Personnel[]|null = null;

async function loadAndDrawPeople(): Promise<void> {
    await loadPeople();
    drawPeople();
}

async function loadPeople(): Promise<{err:string|null}> {
    const {json, err} = await ims.fetchNoThrow<ims.Personnel[]>(url_personnel, {
        headers: {"Cache-Control": "no-cache"},
    });
    if (err != null || json == null) {
        const message = "Failed to load people:\n" + err;
        console.error(message);
        ims.setErrorMessage(message);
        return {err: message};
    }
    json.sort((a: ims.Personnel, b: ims.Personnel): number => (a.handle??"").localeCompare(b.handle??""));
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

        entryItem.dataset["personHandle"] = person.handle;
        entryItem.getElementsByClassName("person-handle")[0]!.textContent = person.handle;
        entryItem.getElementsByClassName("person-status")[0]!.textContent = person.status;

        const showModal: HTMLElement = entryItem.querySelector(".show-set-password-modal")!;
        showModal.addEventListener("click",
            function (_e: MouseEvent): void {
                el.setPasswordModal.dataset["personHandle"] = person.handle;
                el.setPasswordHandle.textContent = person.handle;
                el.setPasswordInput.value = "";
                el.setPasswordConfirm.value = "";
                setPasswordModal.show();
            },
        );

        container.append(entryItemFrag);
    }
}

async function submitSetPassword(): Promise<void> {
    const handle = el.setPasswordModal.dataset["personHandle"];
    if (!handle) {
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

    const url = url_personnelPassword.replace("<person_handle>", encodeURIComponent(handle));
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
