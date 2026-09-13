// SPDX-License-Identifier: Apache-2.0

import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { toAppError } from "@/api/errors";
import { Drawer } from "@/features/dispatch/Drawer";
import { FilterBar } from "@/features/dispatch/FilterBar";
import { HelpSheet } from "@/features/dispatch/HelpSheet";
import type { Lookups } from "@/features/dispatch/query";
import { serializeQuery } from "@/features/dispatch/query";
import { Table } from "@/features/dispatch/Table";
import { useDispatchQuery } from "@/features/dispatch/useDispatchQuery";
import { useKeyboardMap } from "@/features/dispatch/useKeyboardMap";
import { useEventAccess } from "@/features/events/hooks";
import {
  useAreas,
  useIncidents,
  useIncidentTypes,
} from "@/features/incidents/hooks";
import type { IncidentScreenHandle } from "@/features/incidents/IncidentScreen";
import { useLiveEvent } from "@/features/live/useLiveEvent";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { useSession } from "@/session/provider";

// The dispatch table screen (plan 09x, the D2 pick): the drawer shape, the
// filter bar and the URL-driven table over the whole event's incidents.
// Composed inside `Shell` by the incidents index route on a wide window;
// `BoardScreen` still owns the phone (criterion 1). A second Enter, or the
// drawer's "Full page", pushes the real route with the table's query carried
// (criterion 9); the live-row patch (criterion 10) is `features/live/hub.ts`.

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

  const d = useDispatchQuery(rows, lookups, me, !incidentsQuery.isLoading);
  const [help, setHelp] = useState(false);
  const handle = useRef<IncidentScreenHandle>(null);

  // Enter on an open drawer, and its "Full page" control, push the real
  // route with the table's query carried, minus `sel`/`open` (criterion 9):
  // those become the path segment, not a key. `from=table` (finding 4) marks
  // the push as coming from here even when the table's own query is the bare
  // default and so carries nothing else — without it, `IncidentPage` cannot
  // tell "pushed from the table, no filters set" from a bare deep link, and
  // shows no prev/next for either.
  const onFull = useCallback(() => {
    const opened = d.opened;
    if (!opened) {
      return;
    }
    const number = opened.incident.number;
    const carried = serializeQuery(d.query);
    const params: Record<string, string> = { from: "table" };
    for (const [key, value] of Object.entries(carried)) {
      if (value !== undefined && key !== "sel" && key !== "open") {
        params[key] = value;
      }
    }
    router.push({
      pathname: `/events/${eventId}/incidents/${number}`,
      params,
    });
  }, [d.opened, d.query, eventId, router]);

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
    handle,
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
          handle={handle}
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
