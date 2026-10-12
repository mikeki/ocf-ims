// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { PeopleScreen } from "@/features/people/PeopleScreen";
import { rosterAccessFrom } from "@/features/people/roles";
import { EmptyState } from "@/features/shell/EmptyState";
import { LoadingState } from "@/features/shell/LoadingState";
import { useLayoutMode } from "@/features/shell/layoutMode";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { Shell } from "@/features/shell/Shell";

// The roster (plan 09aa) inside the shell, wide windows only. Reachable by an
// admin or someone who may invite reporters; for anyone else the route
// answers the same "Not found" an unknown event does, never a 403 message.

export default function PeopleRoute() {
  const router = useRouter();
  const { eventId: raw } = useLocalSearchParams<{ eventId: string }>();
  const eventId = Number.parseInt(raw, 10);
  const mode = useLayoutMode();
  const valid = Number.isFinite(eventId) && eventId > 0;
  const auth = useQuery(
    ImsService.method.getAuthStatus,
    { eventId: valid ? eventId : 0 },
    { enabled: valid },
  );

  if (!valid) {
    return <EmptyState title="Not found" />;
  }
  if (auth.isLoading) {
    return <LoadingState />;
  }
  const access = rosterAccessFrom(auth.data, eventId);
  if (!access.admin && !access.inviteReporters) {
    return <EmptyState title="Not found" />;
  }

  if (mode !== "wide") {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title="People"
          back={{
            label: "Events",
            onPress: () => router.dismissTo("/events"),
          }}
        />
        <EmptyState
          title="Open the roster on a wider window"
          message="The roster needs a window at least 1024 pixels wide."
        />
      </View>
    );
  }

  return (
    <Shell eventId={eventId}>
      <PeopleScreen eventId={eventId} />
    </Shell>
  );
}
