// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { DashboardScreen } from "@/features/dashboard/DashboardScreen";
import { EmptyState } from "@/features/shell/EmptyState";
import { useLayoutMode } from "@/features/shell/layoutMode";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { Shell } from "@/features/shell/Shell";

// The dashboard (plan 09ab criterion 10): inside the shell on a wide window;
// on a phone the same screen, one column, under a header that goes back to
// the Board — wide only is the design decision, the URL still works. The
// screen answers "Not found" itself when the caller may not write incidents.

export default function DashboardRoute() {
  const router = useRouter();
  const { eventId: raw } = useLocalSearchParams<{ eventId: string }>();
  const eventId = Number.parseInt(raw, 10);
  const mode = useLayoutMode();

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return <EmptyState title="Not found" />;
  }

  // A follow-up opens the incident: in the table's drawer on a wide window
  // (09x's `?open=` URL state), on its own page on a phone, whose incidents
  // route is the Board and never reads `open`.
  const screen = (
    <DashboardScreen
      eventId={eventId}
      onOpenFollowUp={(number) =>
        router.push(
          mode === "wide"
            ? `/events/${eventId}/incidents?open=${number}`
            : `/events/${eventId}/incidents/${number}`,
        )
      }
    />
  );

  if (mode !== "wide") {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title="Dashboard"
          back={{
            label: "Incidents",
            onPress: () => router.dismissTo(`/events/${eventId}/incidents`),
          }}
        />
        {screen}
      </View>
    );
  }

  return <Shell eventId={eventId}>{screen}</Shell>;
}
