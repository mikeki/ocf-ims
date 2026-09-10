// SPDX-License-Identifier: Apache-2.0

import { Redirect } from "expo-router";
import { toAppError } from "@/api/errors";
import { useEvents, useSelectedEvent } from "@/features/events/hooks";
import { defaultEvent } from "@/features/events/newest";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";

// Where a signed-in visit to "/" lands (plan 09n T4): the remembered event's
// incidents, else the newest event's, else the events list (its own empty
// state covers "no events").

export default function AppIndexRoute() {
  const eventsQuery = useEvents();
  const selected = useSelectedEvent();

  if (eventsQuery.isLoading || !selected.loaded) {
    return <LoadingState />;
  }
  if (eventsQuery.error) {
    return (
      <ErrorState
        error={toAppError(eventsQuery.error)}
        onRetry={() => {
          void eventsQuery.refetch();
        }}
      />
    );
  }
  const target = defaultEvent(eventsQuery.data?.events ?? [], selected.eventId);
  if (!target) {
    return <Redirect href="/events" />;
  }
  return <Redirect href={`/events/${target.id}/incidents`} />;
}
