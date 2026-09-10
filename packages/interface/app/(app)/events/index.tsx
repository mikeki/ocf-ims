// SPDX-License-Identifier: Apache-2.0

import { useRouter } from "expo-router";
import { EventsScreen } from "@/features/events/EventsScreen";

export default function EventsRoute() {
  const router = useRouter();
  return (
    <EventsScreen
      onOpenEvent={(eventId) => {
        router.push(`/events/${eventId}/incidents`);
      }}
    />
  );
}
