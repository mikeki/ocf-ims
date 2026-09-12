// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { IncidentPersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { PersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { IncidentScreen } from "@/features/incidents/IncidentScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { makeIncident, makeIncidentView } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The incident's People with request states and the ask (plan 09t), through
// the screen that hosts it, plus the docked "File your report" for the
// person asked.

const ME = 42;

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

function populate(fake: FakeIms) {
  fake.events = [{ id: 1, name: "2026" }];
  fake.people = [
    create(PersonSchema, { personId: 11, handle: "Priya", name: "Priya R." }),
    create(PersonSchema, { personId: 12, handle: "Ray" }),
    create(PersonSchema, { personId: 13, handle: "Trung" }),
  ];
  fake.incidents = [
    makeIncidentView({
      viewerMayAddJournal: true,
      incident: makeIncident({
        eventId: 1,
        number: 214,
        summary: "Lost child",
        reports: [38],
        people: [
          { person: { personId: 12, handle: "Ray" }, involvement: "witness" },
          {
            person: { personId: 13, handle: "Trung" },
            reportRequested: timestampFromDate(
              new Date("2026-08-15T16:00:00Z"),
            ),
          },
          {
            person: { personId: 11, handle: "Priya" },
            reportRequested: timestampFromDate(
              new Date("2026-08-15T15:00:00Z"),
            ),
            reportNumber: 38,
          },
        ],
      }),
    }),
  ];
}

async function typeInto(testID: string, text: string) {
  const input = screen.getByTestId(testID);
  await fireEvent.changeText(input, text);
  await fireEvent(input, "selectionChange", {
    nativeEvent: { selection: { start: text.length, end: text.length } },
  });
}

function renderIncident(
  runtime: Awaited<ReturnType<typeof signedInRuntime>>,
  handlers: Partial<{
    onOpenReport: (n: number) => void;
    onFileReport: () => void;
  }> = {},
) {
  return renderWithProviders(
    <IncidentScreen
      eventId={1}
      number={214}
      onBack={() => undefined}
      onOpenIncident={() => undefined}
      onOpenReport={handlers.onOpenReport ?? (() => undefined)}
      onFileReport={handlers.onFileReport ?? (() => undefined)}
    />,
    runtime,
  );
}

describe("PeopleSection", () => {
  it("shows each person's request state and opens a delivered report", async () => {
    const fake = createFakeIms();
    populate(fake);
    const runtime = await signedInRuntime(fake);
    const onOpenReport = jest.fn();
    await renderIncident(runtime, { onOpenReport });
    await screen.findByTestId("incident-number");
    expect(screen.getByText("Report requested")).toBeTruthy();
    expect(screen.getByText("Report filed")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("person-report-11"));
    expect(onOpenReport).toHaveBeenCalledWith(38);
    // A reader may not ask.
    expect(screen.queryByTestId("ask-report-12")).toBeNull();
    expect(screen.queryByTestId("ask-someone-open")).toBeNull();
    expect(screen.queryByTestId("file-your-report")).toBeNull();
  });

  it("lets a writer ask an attached person, and someone new, for a report", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderIncident(runtime);
    await screen.findByTestId("incident-number");
    // Delivered rows carry no ask; a pending one offers "Ask again".
    expect(screen.queryByTestId("ask-report-11")).toBeNull();
    expect(screen.getByTestId("ask-report-13")).toHaveTextContent("Ask again");

    await fireEvent.press(screen.getByTestId("ask-report-12"));
    await waitFor(() => expect(fake.requestReportRequests).toHaveLength(1));
    expect(fake.requestReportRequests[0]?.personId).toBe(12);
    expect(fake.requestReportRequests[0]?.incidentNumber).toBe(214);
    await waitFor(() =>
      expect(screen.getByTestId("ask-report-12")).toHaveTextContent(
        "Ask again",
      ),
    );

    await fireEvent.press(screen.getByTestId("ask-someone-open"));
    await typeInto("ask-someone", "tru");
    // Trung is already on it; the picker still finds him, and a repeat re-asks.
    await fireEvent.press(await screen.findByTestId("ask-someone-13"));
    await waitFor(() => expect(fake.requestReportRequests).toHaveLength(2));
    expect(fake.requestReportRequests[1]?.personId).toBe(13);
  });

  it("docks File your report for the person asked, until they deliver", async () => {
    const fake = createFakeIms();
    populate(fake);
    const incident = fake.incidents[0]?.incident;
    if (incident) {
      incident.people.push(
        create(IncidentPersonSchema, {
          person: { personId: ME, handle: "Dee" },
          grantedAccess: true,
          reportRequested: timestampFromDate(new Date("2026-08-15T17:00:00Z")),
        }),
      );
    }
    const runtime = await signedInRuntime(fake);
    const onFileReport = jest.fn();
    await renderIncident(runtime, { onFileReport });
    await fireEvent.press(await screen.findByTestId("file-your-report"));
    expect(onFileReport).toHaveBeenCalled();
  });
});
