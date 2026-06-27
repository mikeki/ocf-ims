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
        setPreferredState: (el: HTMLSelectElement) => Promise<void>;
        setPreferredVisitsStatus: (el: HTMLSelectElement) => Promise<void>;
        setPreferredRowsPerPage: (el: HTMLSelectElement) => Promise<void>;
        setPushEnabled: (el: HTMLInputElement) => Promise<void>;
    }
}

//
// Initialize UI
//

const el = {
    preferredState: ims.typedElement("preferred_state", HTMLSelectElement),
    preferredVisitsStatus: ims.typedElement("preferred_visits_status", HTMLSelectElement),
    preferredRowsPerPage: ims.typedElement("preferred_rows_per_page", HTMLSelectElement),
    pushSection: ims.typedElement("push_section", HTMLDivElement),
    pushEnabled: ims.typedElement("push_enabled", HTMLInputElement),
    pushStatus: ims.typedElement("push_status", HTMLDivElement),
};

// The VAPID public key from the auth response; empty when the server has push
// unconfigured (in which case the section stays hidden).
let pushVapidPublicKey = "";

initSettingsPage();

async function initSettingsPage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
    const preferredState = ims.getIncidentsPreferredState();
    if (preferredState) {
        el.preferredState.value = preferredState;
    }
    const preferredVisitsStatus = ims.getVisitsPreferredStatus();
    if (preferredVisitsStatus) {
        el.preferredVisitsStatus.value = preferredVisitsStatus;
    }
    const preferredRowsPerPage = ims.getPreferredTableRowsPerPage();
    if (preferredRowsPerPage) {
        el.preferredRowsPerPage.value = preferredRowsPerPage;
    }
    window.setPreferredState = setPreferredState;
    window.setPreferredVisitsStatus = setPreferredVisitsStatus;
    window.setPreferredRowsPerPage = setPreferredRowsPerPage;
    window.setPushEnabled = setPushEnabled;
    await initPushSection(initResult.authInfo);
}

//
// Web push opt-in (plan 84). Per-device: this reflects and toggles the push
// subscription for the browser the user is currently on.
//

async function initPushSection(authInfo: ims.AuthInfo): Promise<void> {
    if (!authInfo.authenticated) {
        return;
    }
    pushVapidPublicKey = authInfo.pushVapidPublicKey ?? "";
    // Surface the toggle only when this browser can do push AND the server has it
    // configured (shipped a VAPID key). Otherwise leave the whole section hidden.
    if (!ims.pushSupported() || !pushVapidPublicKey) {
        return;
    }
    el.pushSection.classList.remove("hidden");
    await refreshPushUI();
}

async function refreshPushUI(): Promise<void> {
    if (ims.pushPermission() === "denied") {
        el.pushEnabled.checked = false;
        el.pushEnabled.disabled = true;
        el.pushStatus.textContent =
            "Notifications are blocked for this site in your browser settings. " +
            "Re-allow them there to enable push on this device.";
        return;
    }
    el.pushEnabled.disabled = false;
    const sub = await ims.currentPushSubscription();
    el.pushEnabled.checked = sub != null;
    el.pushStatus.textContent = sub != null
        ? "This device will receive push notifications."
        : "Turn this on to get notifications on this device, even when IMS isn't open.";
}

async function setPushEnabled(input: HTMLInputElement): Promise<void> {
    input.disabled = true;
    el.pushStatus.textContent = "Working…";
    if (input.checked) {
        const ok = await ims.enablePush(pushVapidPublicKey);
        if (!ok) {
            input.checked = false;
            input.disabled = false;
            el.pushStatus.textContent =
                "Couldn't enable push. You may have declined the permission prompt, " +
                "or it's blocked in your browser settings.";
            return;
        }
    } else {
        await ims.disablePush();
    }
    input.disabled = false;
    // Re-read the real state rather than trusting the checkbox.
    await refreshPushUI();
}

async function setPreferredState(el: HTMLSelectElement): Promise<void> {
    if (ims.isValidIncidentsTableState(el.value)) {
        ims.setIncidentsPreferredState(el.value);
    } else {
        ims.setIncidentsPreferredState(null);
    }
    ims.controlHasSuccess(el);
}

async function setPreferredVisitsStatus(el: HTMLSelectElement): Promise<void> {
    if (ims.isValidVisitsTableStatus(el.value)) {
        ims.setVisitsPreferredStatus(el.value);
    } else {
        ims.setVisitsPreferredStatus(null);
    }
    ims.controlHasSuccess(el);
}

async function setPreferredRowsPerPage(el: HTMLSelectElement): Promise<void> {
    if (ims.isValidTableRowsPerPage(el.value)) {
        ims.setPreferredTableRowsPerPage(el.value);
    } else {
        ims.setPreferredTableRowsPerPage(null);
    }
    ims.controlHasSuccess(el);
}
