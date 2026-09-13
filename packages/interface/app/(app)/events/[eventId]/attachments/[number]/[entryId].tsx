// SPDX-License-Identifier: Apache-2.0

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEventName } from "@/features/events/hooks";
import { AttachmentScreen } from "@/features/incidents/AttachmentScreen";
import { EmptyState } from "@/features/shell/EmptyState";

// An incident entry's photo, full width (plan 09s), as a modal over the incident.

export default function AttachmentRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    eventId: string;
    number: string;
    entryId: string;
  }>();
  const eventId = Number.parseInt(params.eventId, 10);
  const number = Number.parseInt(params.number, 10);
  const entryId = Number.parseInt(params.entryId, 10);
  const eventName = useEventName(eventId);

  if (
    !Number.isFinite(eventId) ||
    eventId <= 0 ||
    !Number.isFinite(number) ||
    !Number.isFinite(entryId)
  ) {
    return <EmptyState title="Not found" />;
  }

  return (
    <>
      <Stack.Screen options={{ presentation: "modal" }} />
      {eventName ? (
        <AttachmentScreen
          eventName={eventName}
          incidentNumber={number}
          entryId={entryId}
          onClose={() => {
            router.dismissTo(`/events/${eventId}/incidents/${number}`);
          }}
        />
      ) : null}
    </>
  );
}
