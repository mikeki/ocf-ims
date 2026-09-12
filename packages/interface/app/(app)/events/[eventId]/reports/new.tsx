// SPDX-License-Identifier: Apache-2.0

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { NewReportScreen } from "@/features/compose/NewReportScreen";
import { EmptyState } from "@/features/shell/EmptyState";

// The report form (plan 09t), a modal like the incident form. `?incident=N`
// comes from a request's deep link or the incident screen and fixes the link.
// The filed report REPLACES this screen, so back goes to the Board.

export default function NewReportRoute() {
  const router = useRouter();
  const { eventId: raw, incident: rawIncident } = useLocalSearchParams<{
    eventId: string;
    incident?: string;
  }>();
  const eventId = Number.parseInt(raw, 10);
  const incident = rawIncident ? Number.parseInt(rawIncident, 10) : Number.NaN;

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return <EmptyState title="Not found" />;
  }

  return (
    <>
      <Stack.Screen options={{ presentation: "modal" }} />
      <NewReportScreen
        eventId={eventId}
        incident={
          Number.isFinite(incident) && incident > 0 ? incident : undefined
        }
        onCancel={() => {
          router.dismissTo(`/events/${eventId}/incidents`);
        }}
        onFiled={(number) => {
          router.replace(`/events/${eventId}/reports/${number}`);
        }}
      />
    </>
  );
}
