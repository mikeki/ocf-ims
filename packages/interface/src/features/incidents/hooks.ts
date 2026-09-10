// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";

// Domain hooks for the incidents feature (plan 09n T6/T7). Screens read
// these; routes stay thin. The list polls (it's what a person watches during
// the fair) and pulls to refresh; the detail pulls to refresh. ListAreas is
// asked only when the caller can read areas — the screen passes
// useEventAccess(eventId).readAreas as `enabled` — and ListIncidentTypes has
// no per-event gate at all (the taxonomy is global).

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
