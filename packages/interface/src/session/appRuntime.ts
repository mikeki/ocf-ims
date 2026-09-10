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

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryClient } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { cacheBuster, createAppPersister } from "@/api/persist";
import { createAppQueryClient } from "@/api/query";
import { createConnectTransportFactory } from "@/api/transport";
import { apiBaseUrl, binaryWireFormat } from "@/config/env";
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
    makeTransport: createConnectTransportFactory({
      baseUrl: apiBaseUrl(),
      useBinaryFormat: binaryWireFormat(),
    }),
    store: refreshTokenStore,
    platform: Platform.OS === "web" ? "web" : "native",
    onSignedOut: async () => {
      queryClient.clear();
      await persister.removeClient();
    },
  });
  return { ...runtime, queryClient, persister, buster };
}
