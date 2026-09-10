// SPDX-License-Identifier: Apache-2.0

import { createRouterTransport } from "@connectrpc/connect";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { ApiProvider } from "@/api/providers";
import { ThemeProvider } from "@/design/theme";
import { SessionProvider } from "@/session/provider";
import { createRuntime, type Runtime } from "@/session/runtime";
import type { RefreshTokenStore, SessionPlatform } from "@/session/types";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The Jest harness (plan 09l): the real runtime — token cache, refresher, auth
// interceptor, session — over createRouterTransport and the fake ImsService,
// so hooks and the session are tested with no server and no network.

export interface TestRuntimeOptions {
  fake?: FakeIms;
  platform?: SessionPlatform;
  store?: RefreshTokenStore;
  clock?: () => number;
  onSignedOut?: () => void;
}

export interface TestRuntime extends Runtime {
  fake: FakeIms;
  store: RefreshTokenStore;
}

export function createTestRuntime(
  options: TestRuntimeOptions = {},
): TestRuntime {
  const fake = options.fake ?? createFakeIms({ clock: options.clock });
  const store = options.store ?? createMemoryRefreshTokenStore();
  const runtime = createRuntime({
    makeTransport: (interceptors) =>
      createRouterTransport(fake.routes, { transport: { interceptors } }),
    store,
    platform: options.platform ?? "native",
    onSignedOut: options.onSignedOut,
    clock: options.clock,
  });
  return { ...runtime, fake, store };
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
}

/** Renders `ui` under the same providers the root layout mounts. RNTL 14: await it. */
export function renderWithProviders(
  ui: ReactElement,
  runtime: Runtime,
  queryClient: QueryClient = createTestQueryClient(),
) {
  return render(
    <ThemeProvider scheme="light">
      <ApiProvider transport={runtime.transport} queryClient={queryClient}>
        <SessionProvider session={runtime.session}>{ui}</SessionProvider>
      </ApiProvider>
    </ThemeProvider>,
  );
}
