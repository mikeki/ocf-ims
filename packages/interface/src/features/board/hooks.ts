// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import {
  loadSeen,
  type SeenMarks,
  saveSeen,
  withSeen,
} from "@/features/board/seen";
import type { WorkItem } from "@/features/board/work";

// Domain hooks for the Board (plan 09q, slice 3b.1).

/** How often the Board re-polls while mounted. Matches the 3a.3 list. */
const BOARD_POLL_MS = 30_000;

/**
 * The event's reports. Unlike `useAreas` this cannot be pre-gated: `AccessForEvent`
 * has no read-reports flag, so a caller without one gets `permission_denied`
 * and the Board hides the segment (09q).
 */
export function useReports(eventId: number) {
  return useQuery(
    ImsService.method.listReports,
    { eventId, excludeSystemEntries: true },
    { refetchInterval: BOARD_POLL_MS, retry: false },
  );
}

export function useIncidentsForBoard(eventId: number) {
  return useQuery(
    ImsService.method.listIncidents,
    { eventId, excludeSystemEntries: true },
    { refetchInterval: BOARD_POLL_MS },
  );
}

export function useReport(eventId: number, number: number) {
  return useQuery(ImsService.method.getReport, {
    eventId,
    reportNumber: number,
  });
}

export interface Seen {
  marks: SeenMarks;
  /** Whether the first read from storage has finished. */
  loaded: boolean;
  /** Record that a row was OPENED. Never call this from a render. */
  markSeen(item: WorkItem): void;
}

/**
 * This device's unread watermarks for one event. `loaded` lets the screen hold
 * the markers back until the first read finishes.
 */
export function useSeen(eventId: number): Seen {
  const [marks, setMarks] = useState<SeenMarks>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void loadSeen(AsyncStorage, eventId)
      .catch(() => ({}) as SeenMarks)
      .then((stored) => {
        if (!cancelled) {
          setMarks(stored);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const markSeen = useCallback(
    (item: WorkItem) => {
      setMarks((previous) => {
        const next = withSeen(previous, item);
        if (next !== previous) {
          void saveSeen(AsyncStorage, eventId, next).catch(() => undefined);
        }
        return next;
      });
    },
    [eventId],
  );

  return { marks, loaded, markSeen };
}
