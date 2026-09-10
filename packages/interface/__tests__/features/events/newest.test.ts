// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { EventSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/event_pb";
import {
  defaultEvent,
  newestEvent,
  sortEventsNewestFirst,
} from "@/features/events/newest";

function event(id: number, name?: string) {
  return create(EventSchema, { id, name });
}

describe("newestEvent", () => {
  it("picks the highest numeric name", () => {
    const events = [event(1, "2025"), event(2, "2026"), event(3, "TestBRC")];
    expect(newestEvent(events)?.name).toBe("2026");
  });

  it("never lets a higher id beat a numeric name", () => {
    const events = [event(1, "2026"), event(99, "TestBRC")];
    expect(newestEvent(events)?.name).toBe("2026");
  });

  it("falls back to the highest id when nothing is numeric", () => {
    const events = [event(1, "TestBRC"), event(5, "Staging")];
    expect(newestEvent(events)?.id).toBe(5);
  });

  it("is undefined for an empty list", () => {
    expect(newestEvent([])).toBeUndefined();
  });
});

describe("sortEventsNewestFirst", () => {
  it("sorts numeric names descending, then the rest by id descending", () => {
    const events = [
      event(1, "2024"),
      event(2, "TestBRC"),
      event(3, "2026"),
      event(4, "Staging"),
    ];
    const sorted = sortEventsNewestFirst(events);
    expect(sorted.map((e) => e.id)).toEqual([3, 1, 4, 2]);
  });
});

describe("defaultEvent", () => {
  const events = [event(1, "2025"), event(2, "2026")];

  it("prefers a remembered id that is in the list", () => {
    expect(defaultEvent(events, 1)?.id).toBe(1);
  });

  it("ignores a remembered id that is not in the list", () => {
    expect(defaultEvent(events, 99)?.id).toBe(2);
  });

  it("falls back to the newest with no remembered id", () => {
    expect(defaultEvent(events, undefined)?.id).toBe(2);
  });
});
