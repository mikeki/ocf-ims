// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { ReportScreen } from "@/features/board/ReportScreen";
import { EmptyState } from "@/features/shell/EmptyState";

export default function ReportRoute() {
  const router = useRouter();
  const { eventId: rawEvent, number: rawNumber } = useLocalSearchParams<{
    eventId: string;
    number: string;
  }>();
  const eventId = Number.parseInt(rawEvent, 10);
  const number = Number.parseInt(rawNumber, 10);

  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(number)) {
    return <EmptyState title="Not found" />;
  }

  return (
    <ReportScreen
      eventId={eventId}
      number={number}
      // dismissTo the Board: a report reached by deep link has the events
      // list beneath it (the anchor), not the board it belongs to.
      onBack={() => {
        router.dismissTo(`/events/${eventId}/incidents`);
      }}
      onOpenIncident={(n) => {
        router.push(`/events/${eventId}/incidents/${n}`);
      }}
      onCreateIncident={(summary) => {
        router.push({
          pathname: `/events/${eventId}/incidents/new`,
          params: { report: String(number), summary },
        });
      }}
    />
  );
}
