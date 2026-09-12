// SPDX-License-Identifier: Apache-2.0

import { toJson } from "@bufbuild/protobuf";
import { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { CreateIncidentRequestSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import {
  appendUpdate,
  fileRequest,
  isJournalOnly,
} from "@/features/compose/payload";

describe("appendUpdate", () => {
  // The rule a granted reporter's append lives by (09r): the entry, and
  // nothing else on the wire — presence-tracked optionals must stay absent.
  it("sets journal_entries and nothing else", () => {
    const update = appendUpdate({ text: "  On it  ", mentionIds: [3] });
    expect(isJournalOnly(update)).toBe(true);
    expect(update.journalEntries).toEqual([
      expect.objectContaining({ text: "On it", mentionedPersonIds: [3] }),
    ]);
    expect(update.summary).toBeUndefined();
    expect(update.location).toBeUndefined();
    expect(update.incidentTypeIds).toBeUndefined();
  });
});

describe("fileRequest", () => {
  it("carries every field the form set, the first entry aboard", () => {
    const req = fileRequest(1, {
      summary: " Fence down ",
      priority: IncidentPriority.HIGH,
      typeIds: [4, 11],
      areaSlug: "xavanadu",
      description: "South side",
      booth: "12",
      entry: { text: "Near the tap", mentionIds: [3] },
    });
    expect(toJson(CreateIncidentRequestSchema, req)).toEqual({
      eventId: 1,
      incident: {
        priority: "INCIDENT_PRIORITY_HIGH",
        summary: "Fence down",
        incidentTypeIds: { values: [4, 11] },
        location: {
          areaSlug: "xavanadu",
          description: "South side",
          booth: "12",
        },
        journalEntries: [{ text: "Near the tap", mentionedPersonIds: [3] }],
      },
    });
  });

  it("leaves the optional fields absent when the form left them empty", () => {
    const req = fileRequest(1, {
      summary: "Just this",
      priority: IncidentPriority.NORMAL,
      typeIds: [],
      description: "",
      booth: "",
    });
    expect(toJson(CreateIncidentRequestSchema, req)).toEqual({
      eventId: 1,
      incident: { priority: "INCIDENT_PRIORITY_NORMAL", summary: "Just this" },
    });
  });
});
