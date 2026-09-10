// SPDX-License-Identifier: Apache-2.0

import type { MessageInitShape } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import { AreaSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  IncidentPriority,
  IncidentSchema,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import { IncidentTypeSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { IncidentViewSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";

// Fixture builders for the incidents feature's tests (plan 09n T12):
// create(...Schema, …) over sensible defaults, so a test states only the
// field it cares about.

const DEFAULT_TIMESTAMP = timestampFromDate(new Date("2026-08-01T12:00:00Z"));

export function makeIncident(
  overrides: MessageInitShape<typeof IncidentSchema> = {},
): Incident {
  return create(IncidentSchema, {
    event: "2026",
    eventId: 1,
    number: 1,
    created: DEFAULT_TIMESTAMP,
    lastModified: DEFAULT_TIMESTAMP,
    started: DEFAULT_TIMESTAMP,
    state: IncidentState.OPEN,
    priority: IncidentPriority.NORMAL,
    ...overrides,
  });
}

export function makeIncidentView(
  overrides: MessageInitShape<typeof IncidentViewSchema> = {},
): IncidentView {
  return create(IncidentViewSchema, {
    incident: makeIncident(),
    viewerMayAddJournal: false,
    ...overrides,
  });
}

export function makeJournalEntry(
  overrides: MessageInitShape<typeof JournalEntrySchema> = {},
): JournalEntry {
  return create(JournalEntrySchema, {
    id: 1,
    created: DEFAULT_TIMESTAMP,
    author: "Dee",
    systemEntry: false,
    text: "An entry.",
    ...overrides,
  });
}

export function makeArea(
  overrides: MessageInitShape<typeof AreaSchema> = {},
): Area {
  return create(AreaSchema, {
    slug: "center-camp",
    name: "Center Camp",
    approved: true,
    ...overrides,
  });
}

export function makeIncidentType(
  overrides: MessageInitShape<typeof IncidentTypeSchema> = {},
): IncidentType {
  return create(IncidentTypeSchema, {
    id: 1,
    name: "Medical",
    approved: true,
    ...overrides,
  });
}
