// SPDX-License-Identifier: Apache-2.0

import { Stack } from "expo-router";
import { ApiProvider } from "@/api/providers";
import { useScreenAnimation } from "@/design/motion";
import { ThemeProvider } from "@/design/theme";
import { createExpoPushService } from "@/push/expo";
import { PushProvider } from "@/push/service";
import { createAppRuntime } from "@/session/appRuntime";
import { SessionProvider } from "@/session/provider";

// The root layout (plan 09i §5): the providers every route needs — theme,
// the data layer (transport + persisted query cache), the session — around
// the router. The runtime is built once per process, not per render.

const runtime = createAppRuntime();
const push = createExpoPushService();

export default function RootLayout() {
  const animation = useScreenAnimation();
  return (
    <ThemeProvider>
      <ApiProvider
        transport={runtime.transport}
        queryClient={runtime.queryClient}
        persister={runtime.persister}
        buster={runtime.buster}
        blobs={runtime.blobs}
      >
        <SessionProvider session={runtime.session}>
          <PushProvider service={push}>
            <Stack screenOptions={{ headerShown: false, animation }} />
          </PushProvider>
        </SessionProvider>
      </ApiProvider>
    </ThemeProvider>
  );
}
