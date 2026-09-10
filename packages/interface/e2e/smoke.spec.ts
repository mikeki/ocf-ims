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

import { expect, test } from "@playwright/test";

// The 3a.2 smoke: the web export boots in a real browser, the root layout
// mounts the providers, and the session bootstraps — which, with nothing
// answering the Connect routes behind `expo serve` (it serves index.html back),
// must end in the `unreachable` state (a Retry), never in a sign-out: the
// transport treats everything but an Unauthenticated from RefreshToken as
// transient (09l F4). The title is the generic one here, not "Can't reach the
// server": an HTML page where a Connect answer should be is `unknown`, not
// Unavailable. 3a.3 points the suite at the docker stack and walks the tracer.
test("the web export boots and the session bootstrap ends unreachable, not signed out", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("OCF IMS")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByText("Connecting…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
});
