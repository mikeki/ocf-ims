// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  formatTimestamp,
  personLabel,
  priorityLabel,
  stateLabel,
} from "@/lib/format";

describe("stateLabel", () => {
  it("labels OPEN and CLOSED", () => {
    expect(stateLabel(IncidentState.OPEN)).toEqual({
      label: "Open",
      tone: "info",
    });
    expect(stateLabel(IncidentState.CLOSED)).toEqual({
      label: "Closed",
      tone: "neutral",
    });
  });

  it("has no badge for UNSPECIFIED", () => {
    expect(stateLabel(IncidentState.UNSPECIFIED)).toBeUndefined();
  });
});

describe("priorityLabel", () => {
  it("labels HIGH and LOW", () => {
    expect(priorityLabel(IncidentPriority.HIGH)).toEqual({
      label: "High",
      tone: "danger",
    });
    expect(priorityLabel(IncidentPriority.LOW)).toEqual({
      label: "Low",
      tone: "neutral",
    });
  });

  it("has no badge for NORMAL or UNSPECIFIED", () => {
    expect(priorityLabel(IncidentPriority.NORMAL)).toBeUndefined();
    expect(priorityLabel(IncidentPriority.UNSPECIFIED)).toBeUndefined();
  });
});

describe("formatTimestamp", () => {
  it("formats a set timestamp with the platform locale", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(formatTimestamp(timestampFromDate(date))).toBe(
      date.toLocaleString(),
    );
  });

  it("is empty when unset", () => {
    expect(formatTimestamp(undefined)).toBe("");
  });
});

describe("personLabel", () => {
  it("prefers the handle", () => {
    const ref = create(PersonRefSchema, {
      personId: 1,
      handle: "Dee",
      name: "Delilah",
    });
    expect(personLabel(ref)).toBe("Dee");
  });

  it("falls back to the name when there is no handle", () => {
    const ref = create(PersonRefSchema, { personId: 1, name: "Delilah" });
    expect(personLabel(ref)).toBe("Delilah");
  });

  it("falls back to Person #<id> when there is neither", () => {
    const ref = create(PersonRefSchema, { personId: 7 });
    expect(personLabel(ref)).toBe("Person #7");
  });

  it("handles an absent ref", () => {
    expect(personLabel(undefined)).toBe("Unknown");
  });
});
