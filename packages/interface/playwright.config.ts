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

import { defineConfig, devices } from "@playwright/test";

// Web E2E for the Expo client (plan 09i E11). In 3a.1 the target is the static
// web export (`expo export -p web` → dist/) hosted by `expo serve`; 3a.3 points
// the suite at the docker dev stack once there are screens that talk to the
// server. Run `pnpm -F @ocf-ims/interface export:web` before `e2e`.
const CI = Boolean(process.env.CI);
const port = 8082;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec expo serve --port ${port}`,
    url: baseURL,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
