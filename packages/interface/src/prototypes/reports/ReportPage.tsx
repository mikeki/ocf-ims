// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import type { ComponentType, RefObject } from "react";
import { StyleSheet, View } from "react-native";
import { toAppError } from "@/api/errors";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pageMaxWidth } from "@/design/tokens";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import type {
  ReportPaneHandle,
  ReportPaneProps,
  Viewer,
} from "@/prototypes/reports/types";
import { useEditReport } from "@/prototypes/reports/useEditReport";

// The full report page (docs/plans/09z-reports-design.md § The prototype
// round), a retyped copy of src/features/dispatch/IncidentPage.tsx's shape:
// centred at `pageMaxWidth`, its own `ScreenHeader` — back "Reports", the
// number, prev/next — no "Full page" (there is nowhere further to go, as
// the incident page has none either).

export interface ReportPageProps {
  eventId: number;
  number: number;
  viewer: Viewer;
  Variant: ComponentType<ReportPaneProps>;
  prev?: number;
  next?: number;
  onGoTo: (number: number) => void;
  onBack: () => void;
  onOpenIncident: (number: number) => void;
  onCreateIncident: () => void;
  handle?: RefObject<ReportPaneHandle | null>;
}

export function ReportPage(props: ReportPageProps) {
  const {
    eventId,
    number,
    viewer,
    Variant,
    prev,
    next,
    onGoTo,
    onBack,
    onOpenIncident,
    onCreateIncident,
    handle,
  } = props;
  const theme = useTheme();
  const edit = useEditReport(eventId, number);
  const view = useQuery(ImsService.method.getReport, {
    eventId,
    reportNumber: number,
  });

  return (
    <View style={styles.fill}>
      <ScreenHeader
        title={`R-${number}`}
        back={{ label: "Reports", onPress: onBack }}
        right={
          <View style={[styles.nav, { gap: theme.spacing.sm }]}>
            {prev !== undefined ? (
              <TextButton
                label="‹ Prev"
                onPress={() => onGoTo(prev)}
                testID="report-page-prev"
              />
            ) : null}
            {next !== undefined ? (
              <TextButton
                label="Next ›"
                onPress={() => onGoTo(next)}
                testID="report-page-next"
              />
            ) : null}
          </View>
        }
      />
      <View style={styles.body}>
        <View style={styles.center}>
          {view.isLoading ? (
            <LoadingState />
          ) : view.isError ? (
            <ErrorState error={toAppError(view.error)} onRetry={view.refetch} />
          ) : !view.data?.report?.report ? (
            <EmptyState title="Not found" />
          ) : (
            <Variant
              view={view.data.report}
              eventId={eventId}
              edit={edit}
              viewer={viewer}
              onOpenIncident={onOpenIncident}
              onCreateIncident={onCreateIncident}
              handle={handle}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  nav: { flexDirection: "row", alignItems: "center" },
  body: { flex: 1, alignItems: "center" },
  center: { flex: 1, width: "100%", maxWidth: pageMaxWidth },
});
