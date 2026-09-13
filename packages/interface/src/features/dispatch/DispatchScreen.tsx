// SPDX-License-Identifier: Apache-2.0

import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { toAppError } from "@/api/errors";
import { Drawer } from "@/features/dispatch/Drawer";
import { FilterBar } from "@/features/dispatch/FilterBar";
import { HelpSheet } from "@/features/dispatch/HelpSheet";
import type { Lookups } from "@/features/dispatch/query";
import { Table } from "@/features/dispatch/Table";
import { useDispatchQuery } from "@/features/dispatch/useDispatchQuery";
import { useKeyboardMap } from "@/features/dispatch/useKeyboardMap";
import { useEventAccess } from "@/features/events/hooks";
import {
  useAreas,
  useIncidents,
  useIncidentTypes,
} from "@/features/incidents/hooks";
import { useLiveEvent } from "@/features/live/useLiveEvent";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { useSession } from "@/session/provider";

// The dispatch table screen (plan 09x, the D2 pick): the drawer shape, the
// filter bar and the URL-driven table over the whole event's incidents.
// Composed inside `Shell` by the incidents index route on a wide window;
// `BoardScreen` still owns the phone (criterion 1). The full page (criterion
// 9) and the live-row patch (criterion 10) are the second half's.

export interface DispatchScreenProps {
  eventId: number;
}

export function DispatchScreen(props: DispatchScreenProps) {
  const { eventId } = props;
  const router = useRouter();
  const { state } = useSession();
  const me = state.status === "signedIn" ? state.auth.personId : 0;
  const access = useEventAccess(eventId);
  const incidentsQuery = useIncidents(eventId);
  const typesQuery = useIncidentTypes();
  const areasQuery = useAreas(eventId, access.readAreas);
  useLiveEvent(eventId);

  const rows = incidentsQuery.data?.incidents ?? [];
  const lookups: Lookups = useMemo(
    () => ({
      types: typesQuery.data?.incidentTypes ?? [],
      areas: areasQuery.data?.areas ?? [],
    }),
    [typesQuery.data, areasQuery.data],
  );

  const d = useDispatchQuery(rows, lookups, me);
  const [help, setHelp] = useState(false);

  // The full page push is criterion 9's (the second half); until then Enter
  // on an open drawer, and its "Full page" control, do nothing.
  const onFull = useCallback(() => undefined, []);

  const onNewIncident = access.writeIncidents
    ? () => router.push(`/events/${eventId}/incidents/new`)
    : undefined;

  useKeyboardMap({
    query: d.query,
    visible: d.visible,
    help,
    setHelp,
    setQuery: d.setQuery,
    select: d.select,
    open: d.open,
    close: d.close,
    move: d.move,
    onFull,
    onNewIncident,
    searchRef: d.searchRef,
  });

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

  return (
    <View style={styles.fill}>
      <FilterBar
        d={d}
        rows={rows}
        lookups={lookups}
        onHelp={() => setHelp(true)}
      />
      <View style={styles.fill}>
        <Table d={d} lookups={lookups} onRowPress={d.open} />
        <Drawer
          d={d}
          eventId={eventId}
          onFull={onFull}
          onOpenReport={(n) => router.push(`/events/${eventId}/reports/${n}`)}
          onFileReport={(n) =>
            router.push({
              pathname: `/events/${eventId}/reports/new`,
              params: { incident: String(n) },
            })
          }
          onOpenAttachment={(n, entryId) =>
            router.push(`/events/${eventId}/attachments/${n}/${entryId}`)
          }
        />
      </View>
      <HelpSheet
        open={help}
        onClose={() => setHelp(false)}
        writeIncidents={access.writeIncidents}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
