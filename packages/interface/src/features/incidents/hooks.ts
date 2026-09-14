// SPDX-License-Identifier: Apache-2.0

import {
  createQueryOptions,
  useQuery,
  useTransport,
} from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useQueries } from "@tanstack/react-query";

// Domain hooks for the incidents feature (plan 09n T6/T7). Screens read
// these; routes stay thin. The list polls (it's what a person watches during
// the fair) and pulls to refresh; the detail pulls to refresh. ListAreas is
// asked only when the caller can read areas — the screen passes
// useEventAccess(eventId).readAreas as `enabled` — and ListIncidentTypes has
// no per-event gate at all (the taxonomy is global). useOutcomes and
// useAttachedReports are new for the editor (plan 09y criterion 4): the
// outcome picker's data, and one GetReport per attached number so their
// entries can interleave into the journal — each cached under the stock
// connect-query key, so a report screen shares the cache.

/** How often the incidents list re-polls while mounted. */
const INCIDENTS_POLL_MS = 30_000;

export function useIncidents(eventId: number) {
  return useQuery(
    ImsService.method.listIncidents,
    { eventId, excludeSystemEntries: true },
    { refetchInterval: INCIDENTS_POLL_MS },
  );
}

export function useIncident(eventId: number, number: number) {
  return useQuery(ImsService.method.getIncident, {
    eventId,
    incidentNumber: number,
  });
}

export function useAreas(eventId: number, enabled: boolean) {
  return useQuery(ImsService.method.listAreas, { eventId }, { enabled });
}

export function useIncidentTypes() {
  return useQuery(ImsService.method.listIncidentTypes, {});
}

export function useOutcomes() {
  return useQuery(ImsService.method.listOutcomes, {});
}

/** A 404 on one number leaves that report absent; it never fails the others. */
export function useAttachedReports(eventId: number, numbers: number[]) {
  const transport = useTransport();
  return useQueries({
    queries: numbers.map((reportNumber) =>
      createQueryOptions(
        ImsService.method.getReport,
        { eventId, reportNumber },
        { transport },
      ),
    ),
  });
}
