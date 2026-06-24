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

//
// Initialize UI
//

initRootPage();

async function initRootPage(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    if (params.get("logout") != null) {
        // this clears the refresh cookie
        await fetch(url_logout);
        ims.clearLocalStorage();
        ims.clearSessionStorage();
        window.history.replaceState(null, "", url_app);
    }
    const result = await ims.commonPageInit();

    const currentYearLink = document.getElementById("current-year-link") as HTMLAnchorElement|null;
    const loginButton = document.getElementById("login-button");

    if (result.authInfo.authenticated) {
        // Point the "jump to the current event" link at the active (newest) event
        // the user can see, rather than the hardcoded year baked into the template.
        const newest = ims.newestEvent((await result.eventDatas) ?? []);
        if (currentYearLink != null && newest != null) {
            currentYearLink.href = url_viewIncidents.replace("<event_id>", newest.name);
            currentYearLink.textContent = `Jump to the ${newest.name} event`;
        }
        currentYearLink?.focus();
    } else {
        loginButton?.focus();
    }
}
