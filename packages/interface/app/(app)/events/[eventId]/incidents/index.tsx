// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { BoardScreen } from "@/features/board/BoardScreen";
import { EmptyState } from "@/features/shell/EmptyState";

// The Board (plan 09q, slice 3b.1). The path stays `/incidents`: it is the
// event's stack anchor, the `?o=` return path and the tracer's deep link all
// point at it, and renaming the URL would buy a tidier word at the cost of
// every link anyone has already saved.

export default function BoardRoute() {
  const router = useRouter();
  const { eventId: raw } = useLocalSearchParams<{ eventId: string }>();
  const eventId = Number.parseInt(raw, 10);

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return <EmptyState title="Not found" />;
  }

  return (
    <BoardScreen
      eventId={eventId}
      // dismissTo: pop to the events list (the stack's anchor, so it is
      // always beneath) rather than to whatever the previous screen was.
      onBack={() => {
        router.dismissTo("/events");
      }}
      onOpenIncident={(number) => {
        router.push(`/events/${eventId}/incidents/${number}`);
      }}
      onOpenReport={(number) => {
        router.push(`/events/${eventId}/reports/${number}`);
      }}
    />
  );
}
