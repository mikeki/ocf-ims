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
        login: ()=>void;
        toggleShowPassword: ()=>void;
    }
}

//
// Initialize UI
//

const el = {
    loginForm: ims.typedElement("login_form", HTMLFormElement),
    usernameInput: ims.typedElement("username_input", HTMLInputElement),
    passwordInput: ims.typedElement("password_input", HTMLInputElement),
    passwordShowHide: ims.typedElement("password_show_hide", HTMLButtonElement),
};

initLoginPage();

async function initLoginPage(): Promise<void> {
    await ims.commonPageInit();

    window.login = login;
    window.toggleShowPassword = toggleShowPassword;

    el.loginForm.addEventListener("submit", (e: SubmitEvent): void => {
        e.preventDefault();
        login();
    });
    el.usernameInput.focus();
}

function toggleShowPassword(): void {
    if (el.passwordShowHide.textContent === "Show") {
        el.passwordShowHide.textContent = "Hide";
        el.passwordInput.type = "text";
    } else {
        el.passwordShowHide.textContent = "Show";
        el.passwordInput.type = "password";
    }
}

async function login(): Promise<void> {
    const username = el.usernameInput.value;
    const password = el.passwordInput.value;
    const {json, err} = await ims.fetchNoThrow<AuthResponse>(url_auth, {
        body: JSON.stringify({
            "identification": username,
            "password": password,
        }),
    });
    if (err != null || json == null) {
        ims.unhide(".if-authentication-failed");
        return;
    }
    ims.clearLocalStorage();
    ims.clearSessionStorage();
    ims.setAccessToken(json.token);
    ims.setRefreshTokenBy(json.expires_unix_ms);
    const redirect = new URLSearchParams(window.location.search).get("o");

    // There are dangers with using redirects to destinations from unsafe strings.
    // We can limit this by requiring the destination be within IMS and not contain
    // exotic characters.
    //
    // https://github.com/burningmantech/ranger-ims-go/security/code-scanning/4
    // https://github.com/burningmantech/ranger-ims-go/security/code-scanning/6
    const internalDest = (str: string): boolean => str.startsWith("/ims/");
    const looksSafe = (str: string): boolean => /^[\w\-/?=]+$/.test(str);
    if (redirect != null && internalDest(redirect) && looksSafe(redirect)) {
        window.location.replace(redirect);
        return;
    }
    // No explicit destination: jump straight to the active event rather than the
    // home page, so the common case lands where the work is.
    window.location.replace(await activeEventDestination());
}

// activeEventDestination returns the Incidents URL of the "active" event — the
// newest event the signed-in user can see (highest event id). The events list is
// already permission-filtered and excludes groups, so the last by id is the
// current fair. Falls back to the app home if the user belongs to no event yet,
// or the lookup fails.
async function activeEventDestination(): Promise<string> {
    const {json, err} = await ims.fetchNoThrow<ims.EventData[]>(url_events, null);
    if (err != null || json == null) {
        return url_app;
    }
    const newest = ims.newestEvent(json);
    return newest == null ? url_app : url_viewIncidents.replace("<event_id>", newest.name);
}

type AuthResponse = {
    token: string;
    expires_unix_ms: number;
}
