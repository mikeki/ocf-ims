// SPDX-License-Identifier: Apache-2.0

import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { ReactNode } from "react";
import { FlatList, RefreshControl } from "react-native";
import { toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { useEventAccess, useEvents } from "@/features/events/hooks";
import { useAreas, useIncidents } from "@/features/incidents/hooks";
import { IncidentRow } from "@/features/incidents/IncidentRow";
import { sortIncidentsNewestFirst } from "@/features/incidents/lookups";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";

// The incidents list (plan 09n): the event's incidents, newest first, with
// live polling and pull-to-refresh. Navigation is the route's job (T6) — this
// component takes ids and callbacks only.

export interface IncidentsScreenProps {
  eventId: number;
  onBack: () => void;
  onOpenIncident: (number: number) => void;
}

export function IncidentsScreen(props: IncidentsScreenProps) {
  const { eventId, onBack, onOpenIncident } = props;
  const eventsQuery = useEvents();
  const access = useEventAccess(eventId);
  const incidentsQuery = useIncidents(eventId);
  const areasQuery = useAreas(eventId, access.readAreas);

  const eventName =
    eventsQuery.data?.events.find((e) => e.id === eventId)?.name ||
    `Event ${eventId}`;

  return (
    <Box flex={1} bg="background">
      <ScreenHeader
        title={eventName}
        back={{ label: "Events", onPress: onBack }}
      />
      {renderBody(incidentsQuery, areasQuery.data?.areas, onOpenIncident)}
    </Box>
  );
}

function renderBody(
  incidentsQuery: ReturnType<typeof useIncidents>,
  areas: Area[] | undefined,
  onOpenIncident: (number: number) => void,
): ReactNode {
  if (incidentsQuery.isLoading) {
    return <LoadingState />;
  }
  if (incidentsQuery.error) {
    const error = toAppError(incidentsQuery.error);
    if (error.kind === "forbidden") {
      return (
        <EmptyState
          title="No access"
          message="You don't have access to this event's incidents."
        />
      );
    }
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void incidentsQuery.refetch();
        }}
      />
    );
  }
  const views = incidentsQuery.data?.incidents ?? [];
  if (views.length === 0) {
    return (
      <EmptyState
        title="No incidents yet"
        message="Nothing has been reported in this event."
      />
    );
  }
  const sorted = sortIncidentsNewestFirst(views);
  return (
    <FlatList
      style={{ flex: 1 }}
      data={sorted}
      keyExtractor={(view) => String(view.incident?.number)}
      renderItem={({ item }) => (
        <IncidentRow
          view={item}
          areas={areas}
          onPress={() => {
            if (item.incident) {
              onOpenIncident(item.incident.number);
            }
          }}
        />
      )}
      refreshControl={
        <RefreshControl
          testID="incidents-refresh-control"
          refreshing={incidentsQuery.isRefetching && !incidentsQuery.isLoading}
          onRefresh={() => {
            void incidentsQuery.refetch();
          }}
        />
      }
    />
  );
}
