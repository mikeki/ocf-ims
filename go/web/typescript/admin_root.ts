// SPDX-License-Identifier: Apache-2.0

"use strict";

import * as ims from "./ims.ts";

//
// Initialize UI
//

initAdminRootPage();

async function initAdminRootPage(): Promise<void> {
    const initResult = await ims.commonPageInit();
    if (!initResult.authInfo.authenticated) {
        await ims.redirectToLogin();
        return;
    }
}
