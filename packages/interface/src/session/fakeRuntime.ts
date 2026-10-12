// SPDX-License-Identifier: Apache-2.0

import { createRouterTransport } from "@connectrpc/connect";
import type { RuntimeDeps } from "@/session/runtime";
import { createFakeBlobs } from "@/test/fakeBlobs";
import { createFakeIms } from "@/test/fakeIms";
import { buildFairMetrics, FAIR_EVENT } from "@/test/metricsData";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The app on the Jest fake, for a look at a screen with no server at all:
// `EXPO_PUBLIC_FAKE_IMS=1 pnpm -F @ocf-ims/interface start --clear`. The
// transport is the in-process router the tests use (src/test/harness.tsx),
// the refresh-token store is memory (a reload signs out; the real store's
// tokens stay untouched), the blobs are the fake's. Sign in as the fake's
// user (src/test/fakeIms.ts: `dee@example.org` / `correct horse`). The one
// event is `FAIR_EVENT` with the dashboard fixture as its metrics.
//
// Reached only from createAppRuntime behind `__DEV__`, so a production export
// never bundles the fake or the fixtures.

export function createFakeRuntimeDeps(): Pick<
  RuntimeDeps,
  "makeTransport" | "store" | "makeBlobs"
> {
  // Every flag on: GetMetrics wants EventWriteIncidents, and a look should
  // reach every screen (areas, reports, attachments, invites, admin).
  const fake = createFakeIms({
    user: {
      admin: true,
      readAreas: true,
      writeIncidents: true,
      writeReports: true,
      attachFiles: true,
      inviteReporters: true,
    },
  });
  fake.events = [{ ...fake.events[0], ...FAIR_EVENT }];
  fake.metrics[FAIR_EVENT.id] = buildFairMetrics();
  return {
    makeTransport: (interceptors) =>
      createRouterTransport(fake.routes, { transport: { interceptors } }),
    store: createMemoryRefreshTokenStore(),
    makeBlobs: () => createFakeBlobs(),
  };
}
