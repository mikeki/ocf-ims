// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { IncidentPage } from "@/features/dispatch/IncidentPage";
import { IncidentScreen } from "@/features/incidents/IncidentScreen";
import { EmptyState } from "@/features/shell/EmptyState";
import { useLayoutMode } from "@/features/shell/layoutMode";
import { Shell } from "@/features/shell/Shell";

// The 3b incident screen on a phone; the full page (plan 09x criterion 9)
// inside the shell on a wide window (criterion 1) — the drawer's second
// Enter, or its "Full page" control, land here.

export default function IncidentRoute() {
  const router = useRouter();
  const { eventId: rawEventId, number: rawNumber } = useLocalSearchParams<{
    eventId: string;
    number: string;
  }>();
  const eventId = Number.parseInt(rawEventId, 10);
  const number = Number.parseInt(rawNumber, 10);
  const mode = useLayoutMode();

  if (
    !Number.isFinite(eventId) ||
    eventId <= 0 ||
    !Number.isFinite(number) ||
    number <= 0
  ) {
    return <EmptyState title="Not found" />;
  }

  if (mode === "wide") {
    return (
      <Shell eventId={eventId}>
        <IncidentPage eventId={eventId} number={number} />
      </Shell>
    );
  }

  return (
    <IncidentScreen
      eventId={eventId}
      number={number}
      // Back means "the incidents list", not "whatever is beneath": after a
      // deep link or a reload the stack is [events (the anchor), this], and
      // router.back() would skip the list. dismissTo pops to the list when it
      // is in the stack and replaces this screen with it when it is not.
      onBack={() => {
        router.dismissTo(`/events/${eventId}/incidents`);
      }}
      onOpenIncident={(n) => {
        router.push(`/events/${eventId}/incidents/${n}`);
      }}
      onOpenReport={(n) => {
        router.push(`/events/${eventId}/reports/${n}`);
      }}
      onFileReport={() => {
        router.push({
          pathname: `/events/${eventId}/reports/new`,
          params: { incident: String(number) },
        });
      }}
      onOpenAttachment={(entryId) => {
        router.push(`/events/${eventId}/attachments/${number}/${entryId}`);
      }}
    />
  );
}
