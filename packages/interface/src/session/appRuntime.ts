// SPDX-License-Identifier: Apache-2.0

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryClient } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";
import { fetch as expoFetch } from "expo/fetch";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { createBlobs } from "@/api/blobs";
import { cacheBuster, createAppPersister } from "@/api/persist";
import { createAppQueryClient } from "@/api/query";
import { createConnectTransportFactory } from "@/api/transport";
import { apiBaseUrl, binaryWireFormat } from "@/config/env";
import { clearDrafts } from "@/features/compose/drafts";
import { unregisterStored } from "@/push/registration";
import { createRuntime, type Runtime } from "@/session/runtime";
import { refreshTokenStore } from "@/session/store";

// The app's runtime (plan 09l): the real transport (connect-web against
// EXPO_PUBLIC_API_URL), the platform's refresh-token store, the persisted
// query cache. Built once by the root layout. Tests never import this file —
// they build a Runtime around createRouterTransport (src/test/harness.tsx).

export interface AppRuntime extends Runtime {
  queryClient: QueryClient;
  persister: Persister;
  buster: string;
}

export function createAppRuntime(): AppRuntime {
  const queryClient = createAppQueryClient();
  const persister = createAppPersister(AsyncStorage);
  const buster = cacheBuster(Constants.expoConfig?.version);
  const runtime = createRuntime({
    // Development only: EXPO_PUBLIC_FAKE_IMS=1 runs the app on the Jest fake
    // (src/session/fakeRuntime.ts), no server needed. The `__DEV__` guard is
    // what keeps the fake out of a production bundle: Metro folds it to false
    // there and drops the require with the dead branch.
    ...(__DEV__ && process.env.EXPO_PUBLIC_FAKE_IMS === "1"
      ? (
          require("@/session/fakeRuntime") as typeof import("@/session/fakeRuntime")
        ).createFakeRuntimeDeps()
      : {
          makeTransport: createConnectTransportFactory({
            baseUrl: apiBaseUrl(),
            useBinaryFormat: binaryWireFormat(),
            // React Native's fetch cannot stream a response body; Expo's can (09v).
            fetch:
              Platform.OS === "web"
                ? undefined
                : (expoFetch as unknown as typeof globalThis.fetch),
          }),
          store: refreshTokenStore,
          makeBlobs: (deps) => createBlobs({ baseUrl: apiBaseUrl(), ...deps }),
        }),
    platform: Platform.OS === "web" ? "web" : "native",
    beforeSignOut: (client) => unregisterStored(client, AsyncStorage),
    onSignedOut: async () => {
      queryClient.clear();
      await persister.removeClient();
      // Drafts are incident content, like the cache (09r).
      await clearDrafts(AsyncStorage).catch(() => undefined);
    },
  });
  return { ...runtime, queryClient, persister, buster };
}
