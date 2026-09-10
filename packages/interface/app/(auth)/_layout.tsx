// SPDX-License-Identifier: Apache-2.0

import { Redirect, Stack, useGlobalSearchParams } from "expo-router";
import { useScreenAnimation } from "@/design/motion";
import { Splash } from "@/features/shell/Splash";
import { Unreachable } from "@/features/shell/Unreachable";
import { safeReturnPath } from "@/lib/returnPath";
import { useSession } from "@/session/provider";

// The signed-out route group (plan 09n T1): switches on the session state so
// a URL can never bypass the gate. The login screen itself never navigates —
// this layout redirects once the state flips to signedIn, back to the `?o=`
// return path when it is one of our own routes (T3).

export default function AuthLayout() {
  const { state, retry } = useSession();
  const params = useGlobalSearchParams();
  const animation = useScreenAnimation();

  switch (state.status) {
    case "unknown":
      return <Splash />;
    case "unreachable":
      return (
        <Unreachable
          error={state.error}
          onRetry={() => {
            void retry();
          }}
        />
      );
    case "signedIn":
      return <Redirect href={safeReturnPath(params.o) ?? "/"} />;
    case "signedOut":
      return <Stack screenOptions={{ headerShown: false, animation }} />;
  }
}
