// SPDX-License-Identifier: Apache-2.0

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { NewIncidentScreen } from "@/features/compose/NewIncidentScreen";
import { EmptyState } from "@/features/shell/EmptyState";

// The filing form (plan 09r), pulled up by the Board's bar as a modal. The
// filed incident REPLACES this screen, so back from it goes to the Board.

export default function NewIncidentRoute() {
  const router = useRouter();
  const { eventId: raw, summary } = useLocalSearchParams<{
    eventId: string;
    summary?: string;
  }>();
  const eventId = Number.parseInt(raw, 10);

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return <EmptyState title="Not found" />;
  }

  return (
    <>
      <Stack.Screen options={{ presentation: "modal" }} />
      <NewIncidentScreen
        eventId={eventId}
        initialSummary={summary}
        onCancel={() => {
          router.dismissTo(`/events/${eventId}/incidents`);
        }}
        onFiled={(number) => {
          router.replace(`/events/${eventId}/incidents/${number}`);
        }}
      />
    </>
  );
}
