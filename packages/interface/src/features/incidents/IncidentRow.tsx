// SPDX-License-Identifier: Apache-2.0

import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { ListRow } from "@/design/primitives/ListRow";
import { Text } from "@/design/primitives/Text";
import { areaName } from "@/features/incidents/lookups";
import { formatShortTime, priorityLabel, stateLabel } from "@/lib/format";

// One row of the incidents list (plan 09n, restyled in 09o): the number is a
// COLUMN, not a prefix on the summary — a screenful of incidents reads as an
// ordered ledger you can scan down, and "#47" is something you can call out
// over a radio. The summary owns the first line, the area and the marks share
// the second, and the last-modified time is the fixed right column.
//
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
  const state = stateLabel(incident.state);
  const priority = priorityLabel(incident.priority);

  return (
    <ListRow
      title={incident.summary || "(no summary)"}
      subtitle={locationText(incident, areas)}
      testID={`incident-row-${incident.number}`}
      onPress={onPress}
      lead={<Text variant="figure">{`#${incident.number}`}</Text>}
      right={
        <Text variant="caption" color="textMuted">
          {formatShortTime(incident.lastModified)}
        </Text>
      }
      meta={
        <Box row gap="xs">
          {state ? <Badge label={state.label} tone={state.tone} /> : null}
          {priority ? (
            <Badge label={priority.label} tone={priority.tone} />
          ) : null}
          {incident.private ? (
            <Badge label="Private" tone="restricted" />
          ) : null}
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
