// SPDX-License-Identifier: Apache-2.0

import { useRouter } from "expo-router";
import { AlertsScreen } from "@/features/alerts/AlertsScreen";

// The person's alerts (plan 09u), reached from any header's "Alerts".

export default function AlertsRoute() {
  const router = useRouter();
  return (
    <AlertsScreen
      onBack={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/events");
        }
      }}
      onOpen={(href) => {
        router.push(href as never);
      }}
    />
  );
}
