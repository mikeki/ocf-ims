// SPDX-License-Identifier: Apache-2.0
import { createRouterTransport } from "@connectrpc/connect";
import { QueryClient } from "@tanstack/react-query";
import { createRuntime, type Runtime } from "@/session/runtime";
import type { RefreshTokenStore } from "@/session/types";
import { createFakeBlobs } from "@/test/fakeBlobs";
import type { FakeIms } from "@/test/fakeIms";

// The Jest harness's runtime without @/test/harness, which loads
// @testing-library/react-native and throws `expect is not defined` in a browser.

export interface SurfaceRuntime extends Runtime {
  fake: FakeIms;
}

export function createSurfaceRuntime(
  fake: FakeIms,
  store: RefreshTokenStore,
): SurfaceRuntime {
  const runtime = createRuntime({
    makeTransport: (interceptors) =>
      createRouterTransport(fake.routes, { transport: { interceptors } }),
    store,
    platform: "native",
    makeBlobs: () => createFakeBlobs(),
  });
  return { ...runtime, fake };
}

export function createSurfaceQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
