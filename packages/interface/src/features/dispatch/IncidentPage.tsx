// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pageMaxWidth } from "@/design/tokens";
import { HelpSheet } from "@/features/dispatch/HelpSheet";
import { neighboursOf } from "@/features/dispatch/neighbours";
import {
  applyQuery,
  type Lookups,
  type Params,
  parseQuery,
} from "@/features/dispatch/query";
import { useKeyboardMap } from "@/features/dispatch/useKeyboardMap";
import { useEventAccess } from "@/features/events/hooks";
import {
  useAreas,
  useIncidents,
  useIncidentTypes,
} from "@/features/incidents/hooks";
import {
  IncidentScreen,
  type IncidentScreenHandle,
} from "@/features/incidents/IncidentScreen";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { useSession } from "@/session/provider";

// The full incident page (plan 09x criterion 9): reached from a second Enter
// in the drawer, or its "Full page" control, with the table's query carried
// in the URL (minus `sel`/`open` — this screen's own path segment is the
// selection). Prev/next walk that carried query's visible rows, in its sort;
// a bare deep link (no carried query) shows neither. The keyboard map is the
// dispatch table's own hook, reused with the bindings that make sense on one
// incident: `j`/`k` walk, Esc goes back, `a`/`h` reach the composer and the
// system-entries toggle, `?` is the same help sheet. `query.open` is held
// fixed to this incident so those bindings are always live here (unlike the
// drawer, where they gate on the drawer being open).

const QUERY_KEYS = [
  "state",
  "priority",
  "type",
  "area",
  "person",
  "mine",
  "days",
  "q",
  "sort",
  "sel",
  "open",
] as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export interface IncidentPageProps {
  eventId: number;
  number: number;
}

export function IncidentPage(props: IncidentPageProps) {
  const { eventId, number } = props;
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const { state } = useSession();
  const me = state.status === "signedIn" ? state.auth.personId : 0;
  const access = useEventAccess(eventId);
  const incidentsQuery = useIncidents(eventId);
  const typesQuery = useIncidentTypes();
  const areasQuery = useAreas(eventId, access.readAreas);

  const flat = useMemo(() => {
    const out: Params = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] = first(v);
    }
    return out;
  }, [params]);
  // A bare deep link carries none of the table's keys — show no prev/next
  // rather than guess a query the visitor never chose.
  const carried = QUERY_KEYS.some((key) => flat[key] !== undefined);
  const query = useMemo(() => parseQuery(flat, "open"), [flat]);
  const lookups: Lookups = useMemo(
    () => ({
      types: typesQuery.data?.incidentTypes ?? [],
      areas: areasQuery.data?.areas ?? [],
    }),
    [typesQuery.data, areasQuery.data],
  );
  const rows = incidentsQuery.data?.incidents ?? [];
  const visible = useMemo(
    () => (carried ? applyQuery(rows, query, lookups, me) : []),
    [carried, rows, query, lookups, me],
  );
  const { prev, next } = carried ? neighboursOf(visible, number) : {};

  const goTo = useCallback(
    (n: number) => {
      // In place (finding 1): the path segment updates without remounting
      // this screen, the same mechanism the table's `sel`/`open` already use.
      router.setParams({ number: String(n) } as never);
    },
    [router],
  );
  const move = useCallback(
    (delta: 1 | -1) => {
      const n = delta === 1 ? next : prev;
      if (n !== undefined) {
        goTo(n);
      }
    },
    [next, prev, goTo],
  );
  const goBack = useCallback(() => {
    // The table beneath still holds sel/open, so back lands on the drawer;
    // a bare deep link has nothing to go back to.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.dismissTo(`/events/${eventId}/incidents`);
    }
  }, [router, eventId]);

  const [help, setHelp] = useState(false);
  const handle = useRef<IncidentScreenHandle>(null);

  useKeyboardMap({
    query: { open: number, sel: undefined, q: "" },
    visible,
    help,
    setHelp,
    close: goBack,
    move,
    handle,
  });

  return (
    <View style={styles.fill}>
      <ScreenHeader
        title={`#${number}`}
        back={{ label: "Incidents", onPress: goBack }}
        right={
          <View style={[styles.nav, { gap: theme.spacing.sm }]}>
            {prev !== undefined ? (
              <TextButton
                label="‹ Prev"
                onPress={() => goTo(prev)}
                testID="incident-page-prev"
              />
            ) : null}
            {next !== undefined ? (
              <TextButton
                label="Next ›"
                onPress={() => goTo(next)}
                testID="incident-page-next"
              />
            ) : null}
          </View>
        }
      />
      <View style={styles.body}>
        <View style={styles.center}>
          <IncidentScreen
            chrome="embedded"
            handle={handle}
            eventId={eventId}
            number={number}
            onBack={goBack}
            onOpenIncident={(n) =>
              router.push(`/events/${eventId}/incidents/${n}`)
            }
            onOpenReport={(n) => router.push(`/events/${eventId}/reports/${n}`)}
            onFileReport={() =>
              router.push({
                pathname: `/events/${eventId}/reports/new`,
                params: { incident: String(number) },
              })
            }
            onOpenAttachment={(entryId) =>
              router.push(`/events/${eventId}/attachments/${number}/${entryId}`)
            }
          />
        </View>
      </View>
      <HelpSheet
        open={help}
        onClose={() => setHelp(false)}
        writeIncidents={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  nav: { flexDirection: "row", alignItems: "center" },
  body: { flex: 1, alignItems: "center" },
  center: { flex: 1, width: "100%", maxWidth: pageMaxWidth },
});
