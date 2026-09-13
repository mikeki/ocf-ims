// SPDX-License-Identifier: Apache-2.0

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { NewIncidentScreen } from "@/features/compose/NewIncidentScreen";
import { EmptyState } from "@/features/shell/EmptyState";

// The filing form (plan 09r), pulled up by a tap on the Board's bar as a
// modal. The filed incident REPLACES this screen, so back goes to the Board.

export default function NewIncidentRoute() {
  const router = useRouter();
  const {
    eventId: raw,
    report: rawReport,
    summary,
  } = useLocalSearchParams<{
    eventId: string;
    report?: string;
    summary?: string;
  }>();
  const eventId = Number.parseInt(raw, 10);
  const report = rawReport ? Number.parseInt(rawReport, 10) : Number.NaN;

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return <EmptyState title="Not found" />;
  }

  return (
    <>
      <Stack.Screen options={{ presentation: "modal" }} />
      <NewIncidentScreen
        eventId={eventId}
        // "Create an incident from this report" (09t): the report's summary
        // to start from, and the report to link in the same call.
        initialSummary={summary}
        reportNumber={
          Number.isFinite(report) && report > 0 ? report : undefined
        }
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
