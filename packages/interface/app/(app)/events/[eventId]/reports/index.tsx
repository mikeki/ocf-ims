// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { BoardScreen } from "@/features/board/BoardScreen";
import { ReportsScreen } from "@/features/reports/ReportsScreen";
import { EmptyState } from "@/features/shell/EmptyState";
import { useLayoutMode } from "@/features/shell/layoutMode";
import { Shell } from "@/features/shell/Shell";

// The reports table (plan 09z) inside the shell on a wide window; on a phone
// the Board, whose Reports segment is the phone's list of them.

export default function ReportsRoute() {
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
        <ReportsScreen eventId={eventId} />
      </Shell>
    );
  }

  return (
    <BoardScreen
      eventId={eventId}
      initialSegment="reports"
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
