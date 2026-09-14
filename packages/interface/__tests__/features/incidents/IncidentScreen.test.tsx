// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { PersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { IncidentScreen } from "@/features/incidents/IncidentScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import {
  makeArea,
  makeIncident,
  makeIncidentType,
  makeIncidentView,
  makeJournalEntry,
  makeReport,
  makeReportView,
} from "@/test/fixtures";
import {
  createTestQueryClient,
  createTestRuntime,
  renderWithProviders,
} from "@/test/harness";
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

/** Incident #1 in event 1, the shape every editor test below shares. */
function renderScreen(
  runtime: Awaited<ReturnType<typeof signedInRuntime>>,
  queryClient?: ReturnType<typeof createTestQueryClient>,
) {
  const ui = (
    <IncidentScreen
      eventId={1}
      number={1}
      onBack={jest.fn()}
      onOpenIncident={jest.fn()}
      onOpenReport={() => undefined}
      onFileReport={() => undefined}
      onOpenAttachment={() => undefined}
    />
  );
  return queryClient
    ? renderWithProviders(ui, runtime, queryClient)
    : renderWithProviders(ui, runtime);
}

async function typeInto(testID: string, text: string) {
  const input = screen.getByTestId(testID);
  await fireEvent.changeText(input, text);
  await fireEvent(input, "selectionChange", {
    nativeEvent: { selection: { start: text.length, end: text.length } },
  });
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
        onOpenReport={() => undefined}
        onFileReport={() => undefined}
        onOpenAttachment={() => undefined}
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
    // The top row and the Details card's State/Priority/Private rows each
    // wear the same badge (the Ledger repeats the state at a glance).
    expect(screen.getAllByText("Open")).toHaveLength(2);
    expect(screen.getAllByText("High")).toHaveLength(2);
    expect(screen.getAllByText("Private")).toHaveLength(3);
    screen.getByText(/Started/);
    screen.getByText("Created");
    screen.getByText(/by Dee/);
    screen.getByText("Modified");
    screen.getByText("Closed");
    screen.getByText(/Near the stage/);
    screen.getByText("12");
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
        onOpenReport={() => undefined}
        onFileReport={() => undefined}
        onOpenAttachment={() => undefined}
      />,
      runtime,
    );

    await screen.findByText("(no summary)");
    // Outcome, Area, Details, Booth and Types each fall back to "None" for a
    // reader; People, Linked incidents and Reports are sections even empty.
    expect(screen.getAllByText("None")).toHaveLength(5);
    screen.getByText("No one attached");
    screen.getByText("Linked incidents");
    screen.getByText("No linked incidents");
    screen.getByText("Reports");
    screen.getByText("No reports attached");
    screen.getByText("No entries yet.");
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
        onOpenReport={() => undefined}
        onFileReport={() => undefined}
        onOpenAttachment={() => undefined}
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
        onOpenReport={() => undefined}
        onFileReport={() => undefined}
        onOpenAttachment={() => undefined}
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
        onOpenReport={() => undefined}
        onFileReport={() => undefined}
        onOpenAttachment={() => undefined}
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
        onOpenReport={() => undefined}
        onFileReport={() => undefined}
        onOpenAttachment={() => undefined}
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
        onOpenReport={() => undefined}
        onFileReport={() => undefined}
        onOpenAttachment={() => undefined}
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
        onOpenReport={() => undefined}
        onFileReport={() => undefined}
        onOpenAttachment={() => undefined}
      />,
      runtime,
    );

    await screen.findByText("Can't reach the server");
    screen.getByRole("button", { name: "Retry" });
  });

  // The Ledger (plan 09y criteria 7-11, 16): a writer's row is a hard cut to
  // its control that sends one field and hands back; a reader and a grantee
  // see the same shape with nothing to press.

  it("a writer sees the chevrons and Edit; the Priority row sends only priority and hands back", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({ eventId: 1, number: 1, summary: "A" }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    await renderScreen(runtime);

    await screen.findByTestId("summary-edit");
    expect(screen.getByTestId("priority-value")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("priority-value"));
    expect(screen.getByTestId("priority-value-editing")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("High"));

    await waitFor(() => expect(fake.updateRequests).toHaveLength(1));
    expect(fake.updateRequests[0]?.update?.priority).toBe(
      IncidentPriority.HIGH,
    );
    expect(fake.updateRequests[0]?.update?.journalEntries).toEqual([]);
    expect(fake.updateRequests[0]?.update?.state).toBe(
      IncidentState.UNSPECIFIED,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("priority-value-editing")).toBeNull(),
    );
  });

  it("Edit on the summary shows the field; Enter saves", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          summary: "Original",
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    await renderScreen(runtime);

    await fireEvent.press(await screen.findByTestId("summary-edit"));
    const field = screen.getByTestId("summary-field");
    await fireEvent.changeText(field, "Changed summary");
    await fireEvent(field, "submitEditing");

    await waitFor(() => expect(fake.updateRequests).toHaveLength(1));
    expect(fake.updateRequests[0]?.update?.summary).toBe("Changed summary");
    await waitFor(() =>
      expect(screen.getByTestId("summary-value")).toHaveTextContent(
        "Changed summary",
      ),
    );
  });

  it("a reader has no chevron, no Edit and no Strike", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          summary: "A",
          private: true,
          journalEntries: [makeJournalEntry({ id: 1, text: "Entry" })],
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    await renderScreen(runtime);

    await screen.findByText("A");
    expect(screen.queryByTestId("summary-edit")).toBeNull();
    expect(screen.queryByTestId("priority-value")).toBeNull();
    expect(screen.queryByTestId("private-value")).toBeNull();
    expect(screen.queryByTestId("strike-1")).toBeNull();
  });

  it("a grantee (viewerMayAddJournal only) sees the composer and nothing else lit", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        viewerMayAddJournal: true,
        incident: makeIncident({ eventId: 1, number: 1, summary: "A" }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    await renderScreen(runtime);

    await screen.findByTestId("append-composer");
    expect(screen.queryByTestId("summary-edit")).toBeNull();
    expect(screen.queryByTestId("priority-value")).toBeNull();
    expect(screen.queryByTestId("attach-someone-open")).toBeNull();
  });

  it("the private row is disabled for a writer who is neither admin nor creator", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          createdBy: { personId: 7, handle: "Other" },
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    await renderScreen(runtime);

    await fireEvent.press(await screen.findByTestId("private-value"));
    expect(screen.getByTestId("private-toggle").props.disabled).toBe(true);
  });

  it("a failing booth save keeps the typed value and shows the error at the row", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    fake.behaviour.updateIncident = "unavailable";
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          location: { booth: "1" },
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    await renderScreen(runtime);

    await fireEvent.press(await screen.findByTestId("booth-value"));
    const field = screen.getByTestId("booth-field");
    await fireEvent.changeText(field, "412");
    await fireEvent(field, "blur");

    await screen.findByText(/Couldn't save/);
    expect(screen.getByTestId("booth-field").props.value).toBe("412");
  });

  it("an open row and its typed text do not carry over to the next incident", async () => {
    // Prev / Next update the number in place; the target is usually cached,
    // so no loading state remounts the detail — the key must.
    const fake = createFakeIms({ user: { writeIncidents: true } });
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [1, 2].map((number) =>
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number,
          location: { booth: `${number}` },
        }),
      }),
    );
    const runtime = await signedInRuntime(fake);
    function Switcher() {
      const [number, setNumber] = useState(2);
      return (
        <>
          <Pressable testID="go-1" onPress={() => setNumber(1)}>
            <Text>1</Text>
          </Pressable>
          <Pressable testID="go-2" onPress={() => setNumber(2)}>
            <Text>2</Text>
          </Pressable>
          <IncidentScreen
            eventId={1}
            number={number}
            onBack={jest.fn()}
            onOpenIncident={jest.fn()}
            onOpenReport={() => undefined}
            onFileReport={() => undefined}
            onOpenAttachment={() => undefined}
          />
        </>
      );
    }
    await renderWithProviders(<Switcher />, runtime);
    await screen.findByTestId("booth-value");
    await fireEvent.press(screen.getByTestId("go-1"));
    await waitFor(() =>
      expect(screen.getByTestId("incident-number")).toHaveTextContent("#1"),
    );

    await fireEvent.press(screen.getByTestId("booth-value"));
    await fireEvent.changeText(screen.getByTestId("booth-field"), "412");
    await fireEvent.press(screen.getByTestId("go-2"));

    await waitFor(() =>
      expect(screen.getByTestId("incident-number")).toHaveTextContent("#2"),
    );
    expect(screen.queryByTestId("booth-field")).toBeNull();
    expect(fake.updateRequests).toHaveLength(0);
  });

  it("a poke that changes the summary while focused does not replace the typed text", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          summary: "Original",
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    const queryClient = createTestQueryClient();
    await renderScreen(runtime, queryClient);

    await fireEvent.press(await screen.findByTestId("summary-edit"));
    const field = screen.getByTestId("summary-field");
    await fireEvent.changeText(field, "Typed but not sent");

    // The poke: the server's summary changes underneath the focused field.
    const incident = fake.incidents[0]?.incident;
    if (incident) {
      incident.summary = "Changed on the server";
    }
    await act(async () => {
      await queryClient.invalidateQueries();
    });

    expect(screen.getByTestId("summary-field").props.value).toBe(
      "Typed but not sent",
    );
  });

  it("Attach someone, Detach and Strike hit their RPCs", async () => {
    const fake = createFakeIms({ user: { writeIncidents: true } });
    fake.events = [{ id: 1, name: "2026" }];
    fake.people = [create(PersonSchema, { personId: 5, handle: "Sam" })];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          people: [
            { person: { personId: 2, handle: "Ray" }, hasEventAccess: true },
          ],
          journalEntries: [makeJournalEntry({ id: 9, text: "An entry" })],
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    await renderScreen(runtime);
    await screen.findByTestId("incident-number");

    await fireEvent.press(screen.getByTestId("attach-someone-open"));
    await typeInto("attach-someone", "sam");
    await fireEvent.press(await screen.findByTestId("attach-someone-5"));
    await waitFor(() => expect(fake.attachRequests).toHaveLength(1));
    expect(fake.attachRequests[0]?.personId).toBe(5);

    await fireEvent.press(screen.getByTestId("detach-2"));
    await waitFor(() => expect(fake.detachRequests).toHaveLength(1));
    expect(fake.detachRequests[0]?.personId).toBe(2);

    await fireEvent.press(screen.getByTestId("strike-9"));
    await waitFor(() => expect(fake.entryUpdateRequests).toHaveLength(1));
    expect(fake.entryUpdateRequests[0]?.entry?.stricken).toBe(true);
  });

  it("the attached report's entries carry Report #n; the journal is newest first with the composer on top", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.reports = [
      makeReportView({
        report: makeReport({
          number: 7,
          journalEntries: [
            makeJournalEntry({
              id: 701,
              text: "Report entry",
              created: timestampFromDate(new Date("2026-08-01T10:30:00Z")),
            }),
          ],
        }),
      }),
    ];
    fake.incidents = [
      makeIncidentView({
        viewerMayAddJournal: true,
        incident: makeIncident({
          eventId: 1,
          number: 1,
          reports: [7],
          journalEntries: [
            makeJournalEntry({
              id: 1,
              text: "Older entry",
              created: timestampFromDate(new Date("2026-08-01T09:00:00Z")),
            }),
            makeJournalEntry({
              id: 2,
              text: "Newer entry",
              created: timestampFromDate(new Date("2026-08-01T11:00:00Z")),
            }),
          ],
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);
    const view = await renderScreen(runtime);

    const journal = screen.getByTestId("journal");
    await within(journal).findByText("Newer entry");
    await within(journal).findByText("Report entry");
    await within(journal).findByText("Report #7");
    await within(journal).findByText("Older entry");

    // Reading order, not a serialized tree (some prop deep in the page holds
    // a circular reference JSON.stringify can't cross): walk `children` only.
    const order = textOrder(view.toJSON());
    const composerAt = order.indexOf("Add to the journal");
    const newerAt = order.indexOf("Newer entry");
    const reportAt = order.indexOf("Report entry");
    const olderAt = order.indexOf("Older entry");
    expect(composerAt).toBeGreaterThan(-1);
    expect(composerAt).toBeLessThan(newerAt);
    expect(newerAt).toBeLessThan(reportAt);
    expect(reportAt).toBeLessThan(olderAt);
  });
});

/** The rendered text, in reading order — ignores `props`, so it never trips
 * over a circular one. */
function textOrder(
  node: unknown,
  acc: string[] = [],
  seen = new WeakSet(),
): string[] {
  if (typeof node === "string") {
    acc.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) {
      textOrder(child, acc, seen);
    }
  } else if (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    textOrder((node as { children?: unknown }).children, acc, seen);
  }
  return acc;
}
