// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";

// Web E2E for the Expo client (plan 09i E11). `smoke.spec.ts` runs against the
// static web export (`expo export -p web` → dist/) with nothing behind the
// Connect routes (CI's mode). `tracer.spec.ts` (plan 09n T11) runs the read-only
// tracer against a real server: E2E_BASE_URL, when set, is that server's own
// origin (the staging instance's hosted web build, 09m step 2) and no local
// server is started; unset, the local export is served on :8082 by
// e2e/serve.mjs (used for the interim mode — the export built with
// EXPO_PUBLIC_API_URL pointed at staging). That server has the single-page
// fallback the hosted Caddy has and `expo serve` lacks, so a deep link loads
// the app locally too. Run `pnpm -F @ocf-ims/interface export:web` first
// unless E2E_BASE_URL is set.
const CI = Boolean(process.env.CI);
const port = 8082;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

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
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `node e2e/serve.mjs ${port}`,
        url: baseURL,
        reuseExistingServer: !CI,
        timeout: 60_000,
      },
});
