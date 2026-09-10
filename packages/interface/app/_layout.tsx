// SPDX-License-Identifier: Apache-2.0

import { Stack } from "expo-router";
import { ApiProvider } from "@/api/providers";
import { ThemeProvider } from "@/design/theme";
import { createAppRuntime } from "@/session/appRuntime";
import { SessionProvider } from "@/session/provider";

// The root layout (plan 09i §5): the providers every route needs — theme,
// the data layer (transport + persisted query cache), the session — around
// the router. The runtime is built once per process, not per render.

const runtime = createAppRuntime();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ApiProvider
        transport={runtime.transport}
        queryClient={runtime.queryClient}
        persister={runtime.persister}
        buster={runtime.buster}
      >
        <SessionProvider session={runtime.session}>
          <Stack screenOptions={{ headerShown: false }} />
        </SessionProvider>
      </ApiProvider>
    </ThemeProvider>
  );
}
