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

// Domain hooks for the Board (plan 09q, slice 3b.1). Screens read these;
// routes stay thin.

/** How often the Board re-polls while mounted. Matches the 3a.3 list. */
const BOARD_POLL_MS = 30_000;

/**
 * The event's reports.
 *
 * `AccessForEvent` has no read-reports flag, though the server gates
 * `ListReports` on three separate read permissions (all / own / crew) — so
 * unlike `useAreas`, this one CANNOT be pre-gated and has to ask. A caller
 * with none of them gets `permission_denied`, and the Board hides the segment
 * rather than offering a tab that answers an error. A field on
 * `AccessForEvent` would let the client know beforehand; that is a server
 * change, noted in 09q.
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
 * This device's unread watermarks for one event.
 *
 * Until the first read finishes, `marks` is empty — which would make every
 * row of mine look unread — so `loaded` is exposed and the screen holds the
 * markers back rather than flashing them on and off.
 */
export function useSeen(eventId: number): Seen {
  const [marks, setMarks] = useState<SeenMarks>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    // A storage that cannot be read remembers nothing; the Board still loads.
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
          // Best-effort: the row is marked read in this session either way.
          void saveSeen(AsyncStorage, eventId, next).catch(() => undefined);
        }
        return next;
      });
    },
    [eventId],
  );

  return { marks, loaded, markSeen };
}
