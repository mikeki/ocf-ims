// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { IncidentsScreen } from "@/features/incidents/IncidentsScreen";
import { EmptyState } from "@/features/shell/EmptyState";

export default function IncidentsRoute() {
  const router = useRouter();
  const { eventId: raw } = useLocalSearchParams<{ eventId: string }>();
  const eventId = Number.parseInt(raw, 10);

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return <EmptyState title="Not found" />;
  }

  return (
    <IncidentsScreen
      eventId={eventId}
      onBack={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/events");
        }
      }}
      onOpenIncident={(number) => {
        router.push(`/events/${eventId}/incidents/${number}`);
      }}
    />
  );
}
