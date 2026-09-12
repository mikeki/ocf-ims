// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { ReportSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import { ReportViewSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import {
  changedAtIncident,
  changedAtReport,
  label,
  toIncidentItem,
  whyMineIncident,
  whyMineReport,
} from "@/features/board/work";
import { makeIncident, makeIncidentView } from "@/test/fixtures";

const ME = 7;
const SOMEONE_ELSE = 3;

const me = create(PersonRefSchema, { personId: ME, handle: "Dee" });
const other = create(PersonRefSchema, {
  personId: SOMEONE_ELSE,
  handle: "Marisol",
});

function at(iso: string) {
  return timestampFromDate(new Date(iso));
}

function mentioning(...refs: (typeof me)[]) {
  return create(JournalEntrySchema, {
    id: 1,
    created: at("2026-08-15T16:00:00Z"),
    author: "Marisol",
    text: "@Dee can you take this?",
    mentions: refs,
  });
}

describe("whyMineIncident", () => {
  it("is mine when I created it", () => {
    const view = makeIncidentView({
      incident: makeIncident({ createdBy: me }),
    });
    expect(whyMineIncident(view, ME)).toBe("created");
  });

  it("is mine when I am attached to it", () => {
    const view = makeIncidentView({
      incident: makeIncident({
        createdBy: other,
        people: [{ person: me, hasEventAccess: true }],
      }),
    });
    expect(whyMineIncident(view, ME)).toBe("attached");
  });

  it("is mine when a journal entry mentions me", () => {
    const view = makeIncidentView({
      incident: makeIncident({
        createdBy: other,
        journalEntries: [mentioning(me)],
      }),
    });
    expect(whyMineIncident(view, ME)).toBe("mentioned");
  });

  it("is not mine when none of the three hold", () => {
    const view = makeIncidentView({
      incident: makeIncident({
        createdBy: other,
        people: [{ person: other, hasEventAccess: true }],
        journalEntries: [mentioning(other)],
      }),
    });
    expect(whyMineIncident(view, ME)).toBeUndefined();
  });

  // The one that matters: proto3 scalars default to 0, and so does
  // GetAuthStatus.person_id for an unauthenticated caller. A zero matching an
  // absent created_by would make every unattributed incident everyone's.
  it("classifies nothing when the viewer id is 0", () => {
    const unattributed = makeIncidentView({ incident: makeIncident() });
    expect(unattributed.incident?.createdBy).toBeUndefined();
    expect(whyMineIncident(unattributed, 0)).toBeUndefined();

    const mineByEveryRule = makeIncidentView({
      incident: makeIncident({
        createdBy: create(PersonRefSchema, { personId: 0 }),
        people: [
          {
            person: create(PersonRefSchema, { personId: 0 }),
            hasEventAccess: true,
          },
        ],
        journalEntries: [mentioning(create(PersonRefSchema, { personId: 0 }))],
      }),
    });
    expect(whyMineIncident(mineByEveryRule, 0)).toBeUndefined();
  });
});

describe("whyMineReport", () => {
  function reportView(
    overrides: Parameters<typeof create<typeof ReportSchema>>[1] = {},
  ) {
    return create(ReportViewSchema, {
      report: create(ReportSchema, {
        event: "2026",
        number: 38,
        created: at("2026-08-15T02:00:00Z"),
        ...overrides,
      }),
    });
  }

  it("is mine when I filed it", () => {
    expect(whyMineReport(reportView({ createdBy: me }), ME)).toBe("created");
  });

  it("is mine when an entry mentions me", () => {
    expect(
      whyMineReport(
        reportView({ createdBy: other, journalEntries: [mentioning(me)] }),
        ME,
      ),
    ).toBe("mentioned");
  });

  // There is no "attached to a report" — Report has no `people` at all, so the
  // attachment rule must not silently be applied to one.
  it("has no attachment rule", () => {
    expect(whyMineReport(reportView({ createdBy: other }), ME)).toBeUndefined();
  });

  it("classifies nothing when the viewer id is 0", () => {
    expect(whyMineReport(reportView(), 0)).toBeUndefined();
  });
});

describe("changedAt", () => {
  it("is an incident's last_modified", () => {
    const view = makeIncidentView({
      incident: makeIncident({ lastModified: at("2026-08-15T18:42:00Z") }),
    });
    expect(changedAtIncident(view)).toBe(
      new Date("2026-08-15T18:42:00Z").getTime(),
    );
  });

  it("is a report's newest journal entry", () => {
    const view = create(ReportViewSchema, {
      report: create(ReportSchema, {
        event: "2026",
        number: 42,
        created: at("2026-08-15T11:45:00Z"),
        journalEntries: [
          create(JournalEntrySchema, {
            id: 1,
            created: at("2026-08-15T12:00:00Z"),
          }),
          create(JournalEntrySchema, {
            id: 2,
            created: at("2026-08-15T15:30:00Z"),
          }),
        ],
      }),
    });
    expect(changedAtReport(view)).toBe(
      new Date("2026-08-15T15:30:00Z").getTime(),
    );
  });

  // A report with no entries at all: the reduction over an empty list must
  // fall back to `created` rather than to -Infinity or 0.
  it("falls back to a report's created when it has no entries", () => {
    const view = create(ReportViewSchema, {
      report: create(ReportSchema, {
        event: "2026",
        number: 31,
        created: at("2026-08-15T11:20:00Z"),
      }),
    });
    expect(changedAtReport(view)).toBe(
      new Date("2026-08-15T11:20:00Z").getTime(),
    );
  });
});

describe("label", () => {
  it("marks reports and leaves incidents as they have always been", () => {
    expect(label({ kind: "incident", number: 214 })).toBe("#214");
    expect(label({ kind: "report", number: 38 })).toBe("R-38");
  });
});

describe("toIncidentItem", () => {
  it("resolves the area slug through the caller's lookup", () => {
    const view = makeIncidentView({
      incident: makeIncident({
        location: { areaSlug: "main-stage", booth: "118" },
      }),
    });
    const item = toIncidentItem(view, ME, () => "Main Stage");
    expect(item?.where).toBe("Main Stage · Booth 118");
  });

  it("says so when there is no location at all", () => {
    const item = toIncidentItem(makeIncidentView(), ME, (slug) => slug);
    expect(item?.where).toBe("No location");
  });
});
