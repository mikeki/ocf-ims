// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import type { AccessForEvent } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import {
  loadSelectedEventId,
  saveSelectedEventId,
} from "@/features/events/selected";
import { eventAccess } from "@/lib/permissions";

// Domain hooks for the events feature (plan 09n T6/T7). Screens read these;
// routes stay thin. AsyncStorage is the real module (mocked globally for
// Jest by jest.setup.ts), not injected — see selected.ts for the pure
// load/save this wraps.

/** How long a per-event access answer is trusted before a mount re-asks. */
const EVENT_ACCESS_STALE_MS = 5 * 60_000;

export function useEvents() {
  return useQuery(ImsService.method.listEvents, {});
}

/**
 * The caller's access to one event (plan 09n T7); all-false until
 * GetAuthStatus has answered. GetAuthStatus tolerates an anonymous caller
 * (`authenticated: false`, no error), so such an answer is never trusted for
 * the five minutes — it goes stale at once and the next mount asks again.
 */
export function useEventAccess(eventId: number): AccessForEvent {
  const { data } = useQuery(
    ImsService.method.getAuthStatus,
    { eventId },
    {
      staleTime: (query) =>
        query.state.data?.authenticated ? EVENT_ACCESS_STALE_MS : 0,
    },
  );
  return eventAccess(data, eventId);
}

export interface SelectedEvent {
  eventId: number | undefined;
  /** Whether the initial read from storage has finished. */
  loaded: boolean;
  select(id: number): Promise<void>;
}

export function useSelectedEvent(): SelectedEvent {
  const [eventId, setEventId] = useState<number | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A storage that cannot be read (a locked-down browser) remembers nothing;
    // the screen still loads.
    void loadSelectedEventId(AsyncStorage)
      .catch(() => undefined)
      .then((id) => {
        if (!cancelled) {
          setEventId(id);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback(async (id: number) => {
    setEventId(id);
    try {
      await saveSelectedEventId(AsyncStorage, id);
    } catch {
      // Best-effort: the pick still opens the event (EventsScreen does not await this).
    }
  }, []);

  return { eventId, loaded, select };
}
