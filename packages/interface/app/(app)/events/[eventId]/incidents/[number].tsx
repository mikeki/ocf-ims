// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { IncidentScreen } from "@/features/incidents/IncidentScreen";
import { EmptyState } from "@/features/shell/EmptyState";

export default function IncidentRoute() {
  const router = useRouter();
  const { eventId: rawEventId, number: rawNumber } = useLocalSearchParams<{
    eventId: string;
    number: string;
  }>();
  const eventId = Number.parseInt(rawEventId, 10);
  const number = Number.parseInt(rawNumber, 10);

  if (
    !Number.isFinite(eventId) ||
    eventId <= 0 ||
    !Number.isFinite(number) ||
    number <= 0
  ) {
    return <EmptyState title="Not found" />;
  }

  return (
    <IncidentScreen
      eventId={eventId}
      number={number}
      onBack={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace(`/events/${eventId}/incidents`);
        }
      }}
      onOpenIncident={(n) => {
        router.push(`/events/${eventId}/incidents/${n}`);
      }}
    />
  );
}
