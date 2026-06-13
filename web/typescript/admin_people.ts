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
        showAddPersonModal: ()=>void;
        submitCreatePerson: ()=>Promise<void>;
        submitEditPerson: ()=>Promise<void>;
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
    addPersonModal: ims.typedElement("addPersonModal", HTMLElement),
    addPersonHandle: ims.typedElement("add_person_handle", HTMLInputElement),
    addPersonEmail: ims.typedElement("add_person_email", HTMLInputElement),
    addPersonPassword: ims.typedElement("add_person_password", HTMLInputElement),
    addPersonOnsite: ims.typedElement("add_person_onsite", HTMLInputElement),
    editPersonModal: ims.typedElement("editPersonModal", HTMLElement),
    editPersonHandle: ims.typedElement("edit_person_handle", HTMLElement),
    editPersonStatus: ims.typedElement("edit_person_status", HTMLSelectElement),
    editPersonOnsite: ims.typedElement("edit_person_onsite", HTMLInputElement),
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
    window.showAddPersonModal = showAddPersonModal;
    window.submitCreatePerson = submitCreatePerson;
    window.submitEditPerson = submitEditPerson;

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
    const {json, err} = await ims.fetchNoThrow<ims.Personnel[]>(url_personnel + "?all=true", {
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

        entryItem.dataset["personId"] = (person.person_id ?? "").toString();
        entryItem.getElementsByClassName("person-handle")[0]!.textContent = person.handle;
        entryItem.getElementsByClassName("person-status")[0]!.textContent =
            person.status + (person.onsite ? " · on site" : "");

        const showModal: HTMLElement = entryItem.querySelector(".show-set-password-modal")!;
        showModal.addEventListener("click",
            function (_e: MouseEvent): void {
                el.setPasswordModal.dataset["personId"] = (person.person_id ?? "").toString();
                el.setPasswordHandle.textContent = person.handle;
                el.setPasswordInput.value = "";
                el.setPasswordConfirm.value = "";
                setPasswordModal.show();
            },
        );

        const adminToggle: HTMLButtonElement = entryItem.querySelector(".toggle-admin")!;
        drawAdminToggle(adminToggle, person.is_admin ?? false);
        adminToggle.addEventListener("click",
            function (_e: MouseEvent): void {
                void toggleAdmin(person, adminToggle);
            },
        );

        const showEdit: HTMLElement = entryItem.querySelector(".show-edit-modal")!;
        showEdit.addEventListener("click",
            function (_e: MouseEvent): void {
                el.editPersonModal.dataset["personId"] = (person.person_id ?? "").toString();
                el.editPersonHandle.textContent = person.handle;
                el.editPersonStatus.value = person.status;
                el.editPersonOnsite.checked = person.onsite ?? false;
                ims.bsModal(el.editPersonModal).show();
            },
        );

        container.append(entryItemFrag);
    }
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
    el.addPersonHandle.value = "";
    el.addPersonEmail.value = "";
    el.addPersonPassword.value = "";
    el.addPersonOnsite.checked = false;
    ims.bsModal(el.addPersonModal).show();
}

async function submitCreatePerson(): Promise<void> {
    const handle = el.addPersonHandle.value.trim();
    if (!handle) {
        ims.controlHasError(el.addPersonHandle);
        ims.setErrorMessage("Handle is required.");
        return;
    }
    const password = el.addPersonPassword.value;
    if (password !== "" && password.length < minPasswordLength) {
        ims.controlHasError(el.addPersonPassword);
        ims.setErrorMessage(`Password must be at least ${minPasswordLength} characters (or left blank).`);
        return;
    }

    const {err} = await ims.fetchNoThrow(url_personnel, {
        body: JSON.stringify({
            "handle": handle,
            "email": el.addPersonEmail.value.trim(),
            "password": password,
            "onsite": el.addPersonOnsite.checked,
        }),
    });
    if (err != null) {
        ims.controlHasError(el.addPersonHandle);
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
    const url = url_personnelEdit.replace("<person_id>", encodeURIComponent(personId));
    const {err} = await ims.fetchNoThrow(url, {
        body: JSON.stringify({
            "status": el.editPersonStatus.value,
            "onsite": el.editPersonOnsite.checked,
        }),
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
