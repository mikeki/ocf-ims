// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { PersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { isJournalOnly } from "@/features/compose/payload";
import { IncidentScreen } from "@/features/incidents/IncidentScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import {
  makeIncident,
  makeIncidentView,
  makeJournalEntry,
} from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The docked composer on the incident (plan 09r, slice 3b.2), through the
// screen that hosts it. The fake user is a GRANTED REPORTER — no write bit —
// so the fake refuses anything but a journal-only payload, which is the
// wire-shape rule the slice lives by.

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

function granteeFake(mayAppend = true) {
  const fake = createFakeIms();
  fake.events = [{ id: 1, name: "2026" }];
  fake.people = [
    create(PersonSchema, { personId: 3, handle: "Marisol", name: "M. Q." }),
  ];
  fake.incidents = [
    makeIncidentView({
      viewerMayAddJournal: mayAppend,
      incident: makeIncident({
        eventId: 1,
        number: 214,
        summary: "Lost child",
        journalEntries: [
          makeJournalEntry({ id: 1, author: "Marisol", text: "First" }),
        ],
      }),
    }),
  ];
  return fake;
}

async function typeInto(testID: string, text: string) {
  const input = screen.getByTestId(testID);
  await fireEvent.changeText(input, text);
  await fireEvent(input, "selectionChange", {
    nativeEvent: { selection: { start: text.length, end: text.length } },
  });
}

afterEach(async () => {
  await AsyncStorage.clear();
});

describe("AppendComposer", () => {
  it("appends an entry with a mention, journal-only on the wire, and it lands in the journal", async () => {
    const fake = granteeFake();
    const runtime = await signedInRuntime(fake);
    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={214}
        onBack={() => undefined}
        onOpenIncident={() => undefined}
      />,
      runtime,
    );
    await waitFor(() => expect(screen.getByTestId("append-text")).toBeTruthy());
    await typeInto("append-text", "On it, @Ma");
    await waitFor(() => expect(screen.getByTestId("mention-3")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("mention-3"));
    await fireEvent.press(screen.getByTestId("append-send"));

    await waitFor(() =>
      expect(screen.getByText("On it, @Marisol")).toBeTruthy(),
    );
    expect(fake.updateRequests).toHaveLength(1);
    const update = fake.updateRequests[0]?.update;
    expect(update && isJournalOnly(update)).toBe(true);
    expect(update?.journalEntries[0]?.mentionedPersonIds).toEqual([3]);
    // Sent: the box is empty again, and the entry the server echoed is there.
    await waitFor(() =>
      expect(screen.getByTestId("append-text").props.value).toBe(""),
    );
    expect(fake.incidents[0]?.incident?.journalEntries).toHaveLength(2);
  });

  it("keeps the text and says so when the append fails", async () => {
    const fake = granteeFake();
    fake.behaviour.updateIncident = "unavailable";
    const runtime = await signedInRuntime(fake);
    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={214}
        onBack={() => undefined}
        onOpenIncident={() => undefined}
      />,
      runtime,
    );
    await waitFor(() => expect(screen.getByTestId("append-text")).toBeTruthy());
    await typeInto("append-text", "Still here");
    await fireEvent.press(screen.getByTestId("append-send"));
    await waitFor(() =>
      expect(screen.getByText(/Can't reach the server/)).toBeTruthy(),
    );
    expect(screen.getByTestId("append-text").props.value).toBe("Still here");
    // The optimistic entry was rolled back.
    expect(screen.queryByText("Still here", { exact: true })).toBeNull();
  });

  it("is absent when the caller may not add to the journal", async () => {
    const fake = granteeFake(false);
    const runtime = await signedInRuntime(fake);
    await renderWithProviders(
      <IncidentScreen
        eventId={1}
        number={214}
        onBack={() => undefined}
        onOpenIncident={() => undefined}
      />,
      runtime,
    );
    await waitFor(() => expect(screen.getByText("First")).toBeTruthy());
    expect(screen.queryByTestId("append-composer")).toBeNull();
  });
});
