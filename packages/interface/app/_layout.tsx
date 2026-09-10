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
