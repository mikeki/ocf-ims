// SPDX-License-Identifier: Apache-2.0

import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { fireEvent, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { IncidentScreen } from "@/features/incidents/IncidentScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import {
  makeArea,
  makeIncident,
  makeIncidentType,
  makeIncidentView,
  makeJournalEntry,
} from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// (jest.setup.ts makes TanStack's notifyManager synchronous for every suite;
// this screen chains dependent queries — useEventAccess gates useAreas.)

// See BoardScreen.test.tsx: useEventAccess's GetAuthStatus tolerates an
// anonymous caller (200, authenticated: false) rather than throwing, so a
// call fired before bootstrap finishes would cache "no access" for 5 minutes
// — bootstrap before mounting the screen, not just before its own effect
// fires one.
async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

describe("IncidentScreen", () => {
  it("renders every section of a fully populated incident", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.areas = [makeArea({ slug: "center-camp", name: "Center Camp" })];
    fake.incidentTypes = [makeIncidentType({ id: 5, name: "Medical" })];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 12,
          summary: "A twisted ankle",
          state: IncidentState.OPEN,
          priority: IncidentPriority.HIGH,
          private: true,
          started: timestampFromDate(new Date("2026-08-01T10:00:00Z")),
          created: timestampFromDate(new Date("2026-08-01T10:05:00Z")),
          lastModified: timestampFromDate(new Date("2026-08-01T11:00:00Z")),
          closed: timestampFromDate(new Date("2026-08-01T12:00:00Z")),
          createdBy: { personId: 1, handle: "Dee" },
          location: {
            areaSlug: "center-camp",
            description: "Near the stage",
            booth: "12",
          },
          incidentTypeIds: [5],
          people: [
            {
              person: { personId: 2, handle: "Ray" },
              involvement: "witness",
            },
          ],
          linkedIncidents: [
            {
              eventId: 1,
              eventName: "2026",
              incidentNumber: 3,
              summary: "Related",
            },
          ],
          reports: [9],
          journalEntries: [
            makeJournalEntry({ id: 1, author: "Dee", text: "First entry" }),
          ],
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={12}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    // "#12" appears twice (the ScreenHeader title and the detail's own
    // heading), so the summary — unique — anchors the wait.
    await screen.findByText("A twisted ankle");
    // The area name needs two round trips (GetAuthStatus, then ListAreas) —
    // the slowest thing on this screen — so it anchors the wait too; everything
    // else here is already settled by the time it lands.
    await screen.findByText(/Center Camp/);
    screen.getByText("Open");
    screen.getByText("High");
    screen.getByText("Private");
    screen.getByText(/Started/);
    screen.getByText(/Created .* by Dee/);
    screen.getByText(/Last modified/);
    screen.getByText(/Closed/);
    screen.getByText(/Near the stage/);
    screen.getByText(/Booth 12/);
    screen.getByText("Medical");
    screen.getByText(/Ray/);
    screen.getByText(/witness/);
    screen.getByText("#3");
    screen.getByText("Report #9");
    screen.getByText("First entry");
  });

  it("shows the empty-section fallbacks for a bare incident", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({ incident: makeIncident({ eventId: 1, number: 1 }) }),
    ];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText("(no summary)");
    screen.getByText("No location");
    screen.getByText("None");
    screen.getByText("No one attached");
    screen.getByText("No entries yet.");
    expect(screen.queryByText("Linked incidents")).toBeNull();
    expect(screen.queryByText("Reports")).toBeNull();
  });

  it("hides system entries by default; the switch reveals them", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          journalEntries: [
            makeJournalEntry({
              id: 1,
              text: "Human entry",
              systemEntry: false,
            }),
            makeJournalEntry({
              id: 2,
              text: "System entry",
              systemEntry: true,
            }),
          ],
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText("Human entry");
    expect(screen.queryByText("System entry")).toBeNull();

    await fireEvent(
      screen.getByLabelText("Show system entries"),
      "valueChange",
      true,
    );

    await screen.findByText("System entry");
  });

  it("shows a stricken entry struck through and muted", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          journalEntries: [
            makeJournalEntry({ id: 1, text: "Stricken entry", stricken: true }),
          ],
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    const node = await screen.findByText("Stricken entry");
    const flattened = StyleSheet.flatten(node.props.style);
    expect(flattened.textDecorationLine).toBe("line-through");
  });

  it("lists an attachment by id", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          journalEntries: [
            makeJournalEntry({
              id: 1,
              text: "Entry",
              attachment: { id: "abc123", previewable: false },
            }),
          ],
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText("Attachment abc123");
  });

  it("opens a linked incident on press", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          linkedIncidents: [
            {
              eventId: 1,
              eventName: "2026",
              incidentNumber: 4,
              summary: "Linked",
            },
          ],
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    const onOpenIncident = jest.fn();

    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={1}
        onBack={jest.fn()}
        onOpenIncident={onOpenIncident}
      />,
      runtime,
    );

    await fireEvent.press(await screen.findByText("#4"));

    expect(onOpenIncident).toHaveBeenCalledWith(4);
  });

  it("shows Not found with Back to incidents when the incident doesn't exist", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    const runtime = await signedInRuntime(fake);
    const onBack = jest.fn();

    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={99}
        onBack={onBack}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText("Not found");
    screen.getByText("There's no incident #99 here.");

    await fireEvent.press(screen.getByText("Back to incidents"));

    expect(onBack).toHaveBeenCalled();
  });

  it("shows an error with retry when the detail can't be reached", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.behaviour.getIncident = "unavailable";
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText("Can't reach the server");
    screen.getByRole("button", { name: "Retry" });
  });
});
