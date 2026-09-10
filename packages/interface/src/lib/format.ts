// SPDX-License-Identifier: Apache-2.0

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { PersonRef } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { BadgeTone } from "@/design/primitives/Badge";

// Display labels shared by the incidents screens (plan 09n T10). A screen
// never prints a raw enum name or an unresolved id — it renders through
// these, and a NORMAL/UNSPECIFIED priority or an UNSPECIFIED state means "no
// badge" rather than a fabricated label (the demo seed's priorities 2 and 4
// both land on UNSPECIFIED, so this must not throw or print "undefined").

export function formatTimestamp(ts: Timestamp | undefined): string {
  if (!ts) {
    return "";
  }
  return timestampDate(ts).toLocaleString();
}

export interface Labelled {
  readonly label: string;
  readonly tone: BadgeTone;
}

export function stateLabel(state: IncidentState): Labelled | undefined {
  switch (state) {
    case IncidentState.OPEN:
      return { label: "Open", tone: "info" };
    case IncidentState.CLOSED:
      return { label: "Closed", tone: "neutral" };
    default:
      return undefined;
  }
}

export function priorityLabel(
  priority: IncidentPriority,
): Labelled | undefined {
  switch (priority) {
    case IncidentPriority.HIGH:
      return { label: "High", tone: "danger" };
    case IncidentPriority.LOW:
      return { label: "Low", tone: "neutral" };
    default:
      return undefined;
  }
}

/** handle, else name, else "Person #<id>" (T10) — never the bare registry key alone. */
export function personLabel(ref: PersonRef | undefined): string {
  if (!ref) {
    return "Unknown";
  }
  return ref.handle || ref.name || `Person #${ref.personId}`;
}
