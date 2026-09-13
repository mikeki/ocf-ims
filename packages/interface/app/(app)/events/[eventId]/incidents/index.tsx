// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { BoardScreen } from "@/features/board/BoardScreen";
import { DispatchScreen } from "@/features/dispatch/DispatchScreen";
import { EmptyState } from "@/features/shell/EmptyState";
import { useLayoutMode } from "@/features/shell/layoutMode";
import { Shell } from "@/features/shell/Shell";

// The Board (plan 09q, slice 3b.1) on a phone; the dispatch table (plan 09x,
// slice 3c.1) inside the shell on a wide window (criterion 1). The path
// stays `/incidents`: it is the event's stack anchor and every saved link
// and the tracer point at it.

export default function BoardRoute() {
  const router = useRouter();
  const { eventId: raw } = useLocalSearchParams<{ eventId: string }>();
  const eventId = Number.parseInt(raw, 10);
  const mode = useLayoutMode();

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return <EmptyState title="Not found" />;
  }

  if (mode === "wide") {
    return (
      <Shell eventId={eventId}>
        <DispatchScreen eventId={eventId} />
      </Shell>
    );
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
      onFile={() => {
        router.push(`/events/${eventId}/incidents/new`);
      }}
      onFileReport={() => {
        router.push(`/events/${eventId}/reports/new`);
      }}
      onOpenAlerts={() => {
        router.push("/alerts");
      }}
    />
  );
}
