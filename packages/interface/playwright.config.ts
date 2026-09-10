// SPDX-License-Identifier: Apache-2.0

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
