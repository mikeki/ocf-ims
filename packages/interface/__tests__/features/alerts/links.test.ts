// SPDX-License-Identifier: Apache-2.0

import { NotificationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/notification_pb";
import {
  alertHref,
  alertSubject,
  alertText,
  pushLinkHref,
} from "@/features/alerts/links";
import { makeNotification } from "@/test/fixtures";

// Wording and deep links (plan 09u).

const events = [
  { id: 1, name: "2026" },
  { id: 7, name: "Fair 2026" },
];

describe("alertText / alertSubject", () => {
  it("speaks the templ client's words per type", () => {
    expect(alertText(makeNotification())).toBe("Marisol mentioned you");
    expect(
      alertText(
        makeNotification({ reportNumber: 3, incidentNumber: undefined }),
      ),
    ).toBe("Marisol mentioned you in a report");
    expect(
      alertText(makeNotification({ type: NotificationType.ADDED_TO_INCIDENT })),
    ).toBe("Marisol added you to an incident");
    expect(
      alertText(makeNotification({ type: NotificationType.REPORT_REQUESTED })),
    ).toBe("Marisol asked for your report on an incident");
    expect(alertText(makeNotification({ actor: undefined }))).toBe(
      "Someone mentioned you",
    );
  });

  it("names the record in the Board's notation", () => {
    expect(alertSubject(makeNotification())).toBe("#12 Lost child");
    expect(
      alertSubject(
        makeNotification({
          reportNumber: 3,
          reportSummary: "Fence down",
          incidentNumber: undefined,
        }),
      ),
    ).toBe("R-3 Fence down");
    expect(
      alertSubject(
        makeNotification({
          incidentNumber: undefined,
          incidentSummary: undefined,
        }),
      ),
    ).toBeUndefined();
  });
});

describe("alertHref", () => {
  it("routes by the event's id, per kind", () => {
    expect(alertHref(makeNotification(), events)).toBe(
      "/events/1/incidents/12",
    );
    expect(
      alertHref(
        makeNotification({ event: "Fair 2026", reportNumber: 3 }),
        events,
      ),
    ).toBe("/events/7/reports/3");
    expect(
      alertHref(
        makeNotification({ type: NotificationType.REPORT_REQUESTED }),
        events,
      ),
    ).toBe("/events/1/reports/new?incident=12");
  });

  it("answers nothing for an event the caller cannot see", () => {
    expect(
      alertHref(makeNotification({ event: "2019" }), events),
    ).toBeUndefined();
  });
});

describe("pushLinkHref", () => {
  it("maps the templ app's URLs, decoding the event name", () => {
    expect(pushLinkHref("/ims/app/events/2026/incidents/12", events)).toBe(
      "/events/1/incidents/12",
    );
    expect(pushLinkHref("/ims/app/events/Fair%202026/reports/3", events)).toBe(
      "/events/7/reports/3",
    );
    expect(
      pushLinkHref("/ims/app/events/2026/reports/new?incident=12", events),
    ).toBe("/events/1/reports/new?incident=12");
  });

  it("refuses anything else", () => {
    expect(pushLinkHref("https://evil.example/x", events)).toBeUndefined();
    expect(
      pushLinkHref("/ims/app/events/2019/incidents/1", events),
    ).toBeUndefined();
    expect(
      pushLinkHref("/ims/app/events/2026/incidents/new", events),
    ).toBeUndefined();
    expect(
      pushLinkHref("/ims/app/events/%E0%A4%A/incidents/1", events),
    ).toBeUndefined();
  });
});
