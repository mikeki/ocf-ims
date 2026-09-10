// SPDX-License-Identifier: Apache-2.0

import type { Event } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/event_pb";
import type { ReactNode } from "react";
import { FlatList } from "react-native";
import { toAppError } from "@/api/errors";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { ListRow } from "@/design/primitives/ListRow";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { useEvents, useSelectedEvent } from "@/features/events/hooks";
import { newestEvent, sortEventsNewestFirst } from "@/features/events/newest";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { useSession } from "@/session/provider";

// The events list (plan 09n): the stack's anchor. Picking a row remembers the
// event (T4) and hands its id to the caller — navigation is the route's job
// (T6), so this component takes no router.

export interface EventsScreenProps {
  onOpenEvent: (eventId: number) => void;
}

export function EventsScreen(props: EventsScreenProps) {
  const theme = useTheme();
  const { state, signOut } = useSession();
  const eventsQuery = useEvents();
  const selected = useSelectedEvent();

  const handle = state.status === "signedIn" ? state.auth.user : "";

  return (
    <Box flex={1} bg="background">
      <ScreenHeader title="Events" />
      {renderBody(eventsQuery, selected, props.onOpenEvent)}
      <Box
        row
        align="center"
        justify="space-between"
        p="md"
        gap="md"
        bg="surface"
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        }}
      >
        <Text variant="label" color="textMuted" numberOfLines={1}>
          {`Signed in as ${handle}`}
        </Text>
        <Button
          label="Sign out"
          variant="secondary"
          onPress={() => {
            void signOut();
          }}
        />
      </Box>
    </Box>
  );
}

function renderBody(
  eventsQuery: ReturnType<typeof useEvents>,
  selected: ReturnType<typeof useSelectedEvent>,
  onOpenEvent: (eventId: number) => void,
): ReactNode {
  if (eventsQuery.isLoading) {
    return <LoadingState />;
  }
  if (eventsQuery.error) {
    return (
      <ErrorState
        error={toAppError(eventsQuery.error)}
        onRetry={() => {
          void eventsQuery.refetch();
        }}
      />
    );
  }
  const events = eventsQuery.data?.events ?? [];
  if (events.length === 0) {
    return (
      <EmptyState
        title="No events yet"
        message="You don't have access to any event. Ask a crew leader or an admin."
      />
    );
  }
  const sorted = sortEventsNewestFirst(events);
  const newest = newestEvent(events);
  return (
    <FlatList
      style={{ flex: 1 }}
      data={sorted}
      keyExtractor={(event) => String(event.id)}
      renderItem={({ item }) => (
        <EventRow
          event={item}
          isNewest={newest?.id === item.id}
          isRemembered={
            newest?.id !== item.id &&
            selected.loaded &&
            selected.eventId === item.id
          }
          onPress={() => {
            // Remembering is best-effort; opening never waits on storage.
            void selected.select(item.id);
            onOpenEvent(item.id);
          }}
        />
      )}
    />
  );
}

function EventRow(props: {
  event: Event;
  isNewest: boolean;
  isRemembered: boolean;
  onPress: () => void;
}) {
  const { event, isNewest, isRemembered, onPress } = props;
  return (
    <ListRow
      title={event.name || `Event ${event.id}`}
      testID={`event-row-${event.id}`}
      onPress={onPress}
      right={
        isNewest ? (
          <Badge label="Current" tone="info" />
        ) : isRemembered ? (
          <Badge label="Last opened" tone="neutral" />
        ) : undefined
      }
    />
  );
}
