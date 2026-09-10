// SPDX-License-Identifier: Apache-2.0

import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { ListRow } from "@/design/primitives/ListRow";
import { areaName } from "@/features/incidents/lookups";
import { formatTimestamp, priorityLabel, stateLabel } from "@/lib/format";

// One row of the incidents list (plan 09n): number, summary, resolved
// location, last-modified, and the state / priority / private badges.
// `areas` is undefined both while the lookup hasn't answered and when the
// caller lacks read access (the screen doesn't ask in that case) — either
// way `areaName` falls back to the raw slug.

export interface IncidentRowProps {
  view: IncidentView;
  areas: Area[] | undefined;
  onPress: () => void;
}

export function IncidentRow(props: IncidentRowProps) {
  const { view, areas, onPress } = props;
  const incident = view.incident;
  if (!incident) {
    return null;
  }
  const summary = incident.summary || "(no summary)";
  const subtitle = `${locationText(incident, areas)} · ${formatTimestamp(incident.lastModified)}`;
  const state = stateLabel(incident.state);
  const priority = priorityLabel(incident.priority);

  return (
    <ListRow
      title={`#${incident.number} ${summary}`}
      subtitle={subtitle}
      testID={`incident-row-${incident.number}`}
      onPress={onPress}
      right={
        <Box row gap="xs">
          {state ? <Badge label={state.label} tone={state.tone} /> : null}
          {priority ? (
            <Badge label={priority.label} tone={priority.tone} />
          ) : null}
          {incident.private ? <Badge label="Private" tone="warning" /> : null}
        </Box>
      }
    />
  );
}

function locationText(incident: Incident, areas: Area[] | undefined): string {
  const slug = incident.location?.areaSlug;
  if (slug) {
    return areaName(areas, slug) ?? slug;
  }
  return incident.location?.description || "No location";
}
