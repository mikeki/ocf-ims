// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams } from "expo-router";
import { ThemeProvider } from "@/design/theme";
import type { ColorScheme } from "@/design/tokens";
import { Harness } from "@/prototypes/reports/Harness";

// The 3c.3 prototype round's dev-only route (docs/plans/09z-reports-design.md
// § The prototype round): outside the session gates — the root layout still
// wraps every route in its own real runtime (app/_layout.tsx), but nothing
// under it is used here; `Harness` builds its own signed-in fake runtime and
// shadows it via its own <ApiProvider>/<SessionProvider>. `?v=1` picks the
// variant (Ledger / Account / Companion — `1`/`2`/`3`, `←`/`→`, `Picker.tsx`'s
// own keyboard binding); `?scheme=` picks light/dark for the whole surface.
// Deleted in the 3c.3 PR along with the rest of `src/prototypes/reports/`.

export default function ReportsRoute() {
  const params = useLocalSearchParams<{ scheme?: string }>();
  const scheme: ColorScheme | undefined =
    params.scheme === "light" || params.scheme === "dark"
      ? params.scheme
      : undefined;
  return (
    <ThemeProvider scheme={scheme}>
      <Harness />
    </ThemeProvider>
  );
}
