// SPDX-License-Identifier: Apache-2.0

import { Redirect, Stack, usePathname, useRouter } from "expo-router";
import { Platform } from "react-native";
import { useScreenAnimation } from "@/design/motion";
import { ChangePasswordScreen } from "@/features/auth/ChangePasswordScreen";
import { Splash } from "@/features/shell/Splash";
import { Unreachable } from "@/features/shell/Unreachable";
import { loginHref } from "@/lib/returnPath";
import { PushEffects } from "@/push/PushEffects";
import { useSession } from "@/session/provider";

// The signed-in route group (plan 09n T1/T2/T5): the session gate for every
// app screen, and — while the caller is still using the shared default
// password — the forced-password-change gate INSTEAD of the stack (there is
// no route to navigate around it). The events list is the stack's anchor so
// a screen reached by redirect or deep link always has it beneath it.

export const unstable_settings = {
  anchor: "events/index",
};

export default function AppLayout() {
  const { state, retry } = useSession();
  const pathname = usePathname();
  const router = useRouter();
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
    case "signedOut":
      return <Redirect href={loginHref(pathname, Platform.OS)} />;
    case "signedIn":
      if (state.auth.usingDefaultPassword) {
        return <ChangePasswordScreen />;
      }
      return (
        <>
          <PushEffects onOpen={(href) => router.push(href as never)} />
          <Stack screenOptions={{ headerShown: false, animation }} />
        </>
      );
  }
}
