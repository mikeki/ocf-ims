// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pageMaxWidth } from "@/design/tokens";
import {
  ReportScreen,
  type ReportScreenHandle,
} from "@/features/board/ReportScreen";
import { HelpSheet } from "@/features/dispatch/HelpSheet";
import { useEventAccess } from "@/features/events/hooks";
import { useReportRows } from "@/features/reports/hooks";
import { neighboursOf } from "@/features/reports/neighbours";
import { reportHelpRows } from "@/features/reports/reportHelp";
import {
  applyQuery,
  type Params,
  parseQuery,
} from "@/features/reports/reportQuery";
import { useReportKeyboardMap } from "@/features/reports/useReportKeyboardMap";
import { ScreenHeader } from "@/features/shell/ScreenHeader";

// The full report page (plan 09z criterion 9), shaped as
// src/features/dispatch/IncidentPage.tsx: reached from a second Enter in the
// drawer, or its "Full page" control, with the table's query carried in the
// URL (minus `sel` / `open`: this screen's path segment is the selection).
// Prev / next walk that carried query's visible rows; a bare deep link shows
// neither. Centred at `pageMaxWidth`; `a` focuses the composer, `h` toggles
// history, Esc goes back.

const QUERY_KEYS = ["link", "q", "sort", "sel", "open"] as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export interface ReportPageProps {
  eventId: number;
  number: number;
}

export function ReportPage(props: ReportPageProps) {
  const { eventId, number } = props;
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const access = useEventAccess(eventId);
  const rowsQuery = useReportRows(eventId);

  const flat = useMemo(() => {
    const out: Params = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] = first(v);
    }
    return out;
  }, [params]);
  // `from=table` marks a push from the table even when its query is the bare
  // default and so carries no other key.
  const carried =
    flat.from === "table" || QUERY_KEYS.some((key) => flat[key] !== undefined);
  const query = useMemo(() => parseQuery(flat), [flat]);
  const reports = rowsQuery.data?.reports;
  const visible = useMemo(
    () => (carried ? applyQuery(reports ?? [], query) : []),
    [carried, reports, query],
  );
  const { prev, next } = carried ? neighboursOf(visible, number) : {};

  const goTo = useCallback(
    (n: number) => {
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
    router.dismissTo(`/events/${eventId}/reports`);
  }, [router, eventId]);

  const [help, setHelp] = useState(false);
  const handle = useRef<ReportScreenHandle>(null);
  useReportKeyboardMap({
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
        title={`R-${number}`}
        back={{ label: "Reports", onPress: goBack }}
        right={
          <View style={[styles.nav, { gap: theme.spacing.sm }]}>
            {prev !== undefined ? (
              <TextButton
                label="‹ Prev"
                onPress={() => goTo(prev)}
                testID="report-page-prev"
              />
            ) : null}
            {next !== undefined ? (
              <TextButton
                label="Next ›"
                onPress={() => goTo(next)}
                testID="report-page-next"
              />
            ) : null}
          </View>
        }
      />
      <View style={styles.body}>
        <View style={styles.center}>
          <ReportScreen
            chrome="embedded"
            handle={handle}
            eventId={eventId}
            number={number}
            onBack={goBack}
            onOpenIncident={(n) =>
              router.push(`/events/${eventId}/incidents/${n}`)
            }
            onCreateIncident={(summary) =>
              router.push({
                pathname: `/events/${eventId}/incidents/new`,
                params: { report: String(number), summary },
              })
            }
          />
        </View>
      </View>
      <HelpSheet
        open={help}
        onClose={() => setHelp(false)}
        rows={reportHelpRows(access.writeReports)}
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
