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
        // A logged-in user has no reason to linger on the landing page: send them
        // straight to the active (newest) event they can see. replace() (not assign)
        // keeps the home page out of history, so Back doesn't bounce here.
        const newest = ims.newestEvent((await result.eventDatas) ?? []);
        if (newest != null) {
            window.location.replace(url_viewIncidents.replace("<event_id>", newest.name));
            return;
        }
        // No visible event to jump to — stay put but still repoint the link, so the
        // page remains usable rather than redirect-looping.
        if (currentYearLink != null) {
            currentYearLink.textContent = "Jump to the current event";
        }
        currentYearLink?.focus();
    } else {
        loginButton?.focus();
    }
}
