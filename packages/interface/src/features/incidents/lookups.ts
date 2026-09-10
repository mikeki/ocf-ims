// SPDX-License-Identifier: Apache-2.0

import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";

// Lookups the incidents screens use (plan 09n T7): they never block a
// screen. A failed or absent ListAreas/ListIncidentTypes read falls back to
// the raw slug or a "Type #<id>" placeholder rather than stalling the
// incident on a second RPC.

/**
 * The area's display name, else its slug, else `undefined` when there is no
 * slug at all (no area set on the incident). `areas` is `undefined` both
 * while the lookup hasn't answered and when the caller can't read areas
 * (`useEventAccess(eventId).readAreas` — the caller skips the request
 * entirely rather than eating a PermissionDenied), and either way the slug
 * itself is still a safe thing to show.
 */
export function areaName(
  areas: Area[] | undefined,
  slug: string | undefined,
): string | undefined {
  if (!slug) {
    return undefined;
  }
  const area = areas?.find((a) => a.slug === slug);
  return area?.name || slug;
}

/** The type's name, else "Type #<id>" — never a raw id or "undefined". */
export function typeName(
  types: IncidentType[] | undefined,
  id: number,
): string {
  const type = types?.find((t) => t.id === id);
  return type?.name || `Type #${id}`;
}

/** Highest incident number first. */
export function sortIncidentsNewestFirst(
  views: IncidentView[],
): IncidentView[] {
  return [...views].sort(
    (a, b) => (b.incident?.number ?? 0) - (a.incident?.number ?? 0),
  );
}
