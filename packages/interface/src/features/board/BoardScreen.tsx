// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { FlatList, RefreshControl } from "react-native";
import { toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import {
  useIncidentsForBoard,
  useReports,
  useSeen,
} from "@/features/board/hooks";
import { SegmentedControl } from "@/features/board/SegmentedControl";
import { isUnread } from "@/features/board/seen";
import { WorkRow } from "@/features/board/WorkRow";
import {
  newestFirst,
  toIncidentItem,
  toReportItem,
  type WorkItem,
} from "@/features/board/work";
import { useEventAccess, useEvents } from "@/features/events/hooks";
import { useAreas } from "@/features/incidents/hooks";
import { areaName } from "@/features/incidents/lookups";
import { EmptyState } from "@/features/shell/EmptyState";
import { ErrorState } from "@/features/shell/ErrorState";
import { LoadingState } from "@/features/shell/LoadingState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { useSession } from "@/session/provider";

// The Board (plan 09q, slice 3b.1): the event's incidents and reports behind an
// All / Mine / Reports segment, opening on Mine. "Mine" is computed client-side
// from the list responses; a server filter is a noted follow-up (09i §8).

type SegmentKey = "all" | "mine" | "reports";

export interface BoardScreenProps {
  eventId: number;
  onBack: () => void;
  onOpenIncident: (number: number) => void;
  onOpenReport: (number: number) => void;
}

export function BoardScreen(props: BoardScreenProps) {
  const { eventId, onBack, onOpenIncident, onOpenReport } = props;
  const [segment, setSegment] = useState<SegmentKey>("mine");

  const { state } = useSession();
  const me = state.status === "signedIn" ? state.auth.personId : 0;

  const access = useEventAccess(eventId);
  const eventsQuery = useEvents();
  const incidentsQuery = useIncidentsForBoard(eventId);
  const reportsQuery = useReports(eventId);
  const areasQuery = useAreas(eventId, access.readAreas);
  const seen = useSeen(eventId);

  const areas = areasQuery.data?.areas;
  const incidents = useMemo(() => {
    const resolve = (slug: string) => areaName(areas, slug) ?? slug;
    return (incidentsQuery.data?.incidents ?? [])
      .map((view) => toIncidentItem(view, me, resolve))
      .filter((item): item is WorkItem => item !== undefined)
      .sort(newestFirst);
  }, [incidentsQuery.data, areas, me]);

  const reports = useMemo(
    () =>
      (reportsQuery.data?.reports ?? [])
        .map((view) => toReportItem(view, me))
        .filter((item): item is WorkItem => item !== undefined)
        .sort(newestFirst),
    [reportsQuery.data, me],
  );

  // Held back until the watermarks are read, or every mine-row flashes unread.
  const unread = (item: WorkItem) => seen.loaded && isUnread(item, seen.marks);

  // AccessForEvent has no read-reports flag, so the segment can only go away
  // once ListReports answers permission_denied (09q).
  const reportsForbidden =
    Boolean(reportsQuery.error) &&
    toAppError(reportsQuery.error).kind === "forbidden";

  const mine = incidents.filter((item) => item.mine);
  const segments = [
    { key: "all" as const, label: "All" },
    {
      key: "mine" as const,
      label: "Mine",
      count: mine.filter(unread).length,
    },
    ...(reportsForbidden
      ? []
      : [
          {
            key: "reports" as const,
            label: "Reports",
            count: reports.filter(unread).length,
          },
        ]),
  ];
  const active = segment === "reports" && reportsForbidden ? "mine" : segment;

  const eventName =
    eventsQuery.data?.events.find((e) => e.id === eventId)?.name ||
    `Event ${eventId}`;

  return (
    <Box flex={1} bg="background">
      <ScreenHeader
        title="Board"
        back={{ label: "Events", onPress: onBack }}
        right={
          <Text variant="label" color="textMuted">
            {eventName}
          </Text>
        }
      />
      <SegmentedControl
        segments={segments}
        current={active}
        onSelect={setSegment}
      />
      {renderBody({
        segment: active,
        all: incidents,
        mine,
        reports,
        incidentsQuery,
        reportsQuery,
        unread,
        onOpenIncident: (item) => {
          seen.markSeen(item);
          onOpenIncident(item.number);
        },
        onOpenReport: (item) => {
          seen.markSeen(item);
          onOpenReport(item.number);
        },
      })}
    </Box>
  );
}

interface BodyArgs {
  segment: SegmentKey;
  all: WorkItem[];
  mine: WorkItem[];
  reports: WorkItem[];
  incidentsQuery: ReturnType<typeof useIncidentsForBoard>;
  reportsQuery: ReturnType<typeof useReports>;
  unread: (item: WorkItem) => boolean;
  onOpenIncident: (item: WorkItem) => void;
  onOpenReport: (item: WorkItem) => void;
}

function renderBody(args: BodyArgs): ReactNode {
  const query =
    args.segment === "reports" ? args.reportsQuery : args.incidentsQuery;

  if (query.isLoading) {
    return <LoadingState />;
  }
  if (query.error) {
    const error = toAppError(query.error);
    if (error.kind === "forbidden") {
      return (
        <EmptyState
          title="No access"
          message={
            args.segment === "reports"
              ? "You don't have access to this event's reports."
              : "You don't have access to this event's incidents."
          }
        />
      );
    }
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const items =
    args.segment === "all"
      ? args.all
      : args.segment === "mine"
        ? args.mine
        : args.reports;

  if (items.length === 0) {
    return <EmptyState {...emptyFor(args.segment)} />;
  }

  return (
    // Virtualized: "All" is hundreds of rows by the Saturday of a fair.
    <FlatList
      style={{ flex: 1 }}
      data={items}
      extraData={args.segment}
      keyExtractor={(item) => `${item.kind}-${item.number}`}
      renderItem={({ item }) => (
        <WorkRow
          item={item}
          unread={args.unread(item)}
          showOwnership={args.segment === "all"}
          onPress={
            item.kind === "incident"
              ? () => args.onOpenIncident(item)
              : () => args.onOpenReport(item)
          }
        />
      )}
      refreshControl={
        <RefreshControl
          testID="board-refresh-control"
          refreshing={query.isRefetching && !query.isLoading}
          onRefresh={() => {
            void query.refetch();
          }}
        />
      }
    />
  );
}

function emptyFor(segment: SegmentKey): { title: string; message: string } {
  if (segment === "mine") {
    return {
      title: "Nothing is yours yet",
      message:
        "Incidents you file, get attached to, or get mentioned in show up here.",
    };
  }
  if (segment === "reports") {
    return {
      title: "No reports",
      message: "Nothing has been reported in this event.",
    };
  }
  return {
    title: "No incidents yet",
    message: "Nothing has been reported in this event.",
  };
}
