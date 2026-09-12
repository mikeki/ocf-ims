// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { PersonSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { DRAFTS_KEY } from "@/features/compose/drafts";
import { NewIncidentScreen } from "@/features/compose/NewIncidentScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { makeArea, makeIncidentType } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The filing form against the real runtime and the fake's write RPCs
// (plan 09r, slice 3b.2). Bootstrap before mounting (see IncidentScreen.test).

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

function writerFake() {
  const fake = createFakeIms({ user: { writeIncidents: true } });
  fake.events = [{ id: 1, name: "2026" }];
  fake.areas = [makeArea({ slug: "center-camp", name: "Center Camp" })];
  fake.incidentTypes = [
    makeIncidentType({ id: 1, name: "Medical" }),
    makeIncidentType({ id: 9, name: "Retired", hidden: true }),
  ];
  fake.people = [
    create(PersonSchema, {
      personId: 11,
      handle: "Priya",
      name: "Priya Raman",
    }),
  ];
  return fake;
}

/** Puts the caret at the end, which is what typing does and what the typeahead reads. */
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

describe("NewIncidentScreen", () => {
  it("files with every field: a proposed type, a created area, a first entry with a mention", async () => {
    const fake = writerFake();
    const runtime = await signedInRuntime(fake);
    const onFiled = jest.fn();
    await renderWithProviders(
      <NewIncidentScreen
        eventId={1}
        initialSummary="Pump leaking"
        onCancel={() => undefined}
        onFiled={onFiled}
      />,
      runtime,
    );
    expect(screen.getByTestId("summary").props.value).toBe("Pump leaking");
    await waitFor(() => expect(screen.getByTestId("type-1")).toBeTruthy());
    expect(screen.queryByTestId("type-9")).toBeNull(); // hidden

    await fireEvent.press(screen.getByTestId("priority-high"));
    await fireEvent.press(screen.getByTestId("type-1"));
    await fireEvent.changeText(screen.getByTestId("type-search"), "Fencing");
    await fireEvent.press(screen.getByTestId("type-propose"));
    await waitFor(() => expect(screen.getByTestId("type-10")).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId("area-search"), "Pump House");
    await fireEvent.press(screen.getByTestId("area-create"));
    await waitFor(() =>
      expect(screen.getByTestId("area-selected")).toBeTruthy(),
    );
    await fireEvent.changeText(screen.getByTestId("description"), "Under it");
    await fireEvent.changeText(screen.getByTestId("booth"), "7");

    await typeInto("first-entry", "Water pooling, @Pr");
    await waitFor(() => expect(screen.getByTestId("mention-11")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("mention-11"));
    expect(screen.getByTestId("first-entry").props.value).toBe(
      "Water pooling, @Priya ",
    );

    await fireEvent.press(screen.getByTestId("file-incident"));
    await waitFor(() => expect(onFiled).toHaveBeenCalledWith(1));
    const filed = fake.incidents[0]?.incident;
    expect(filed?.summary).toBe("Pump leaking");
    expect(filed?.priority).toBe(IncidentPriority.HIGH);
    expect(filed?.incidentTypeIds).toEqual([1, 10]);
    expect(filed?.location).toEqual(
      expect.objectContaining({
        areaSlug: "pump-house",
        description: "Under it",
        booth: "7",
      }),
    );
    expect(filed?.journalEntries[0]?.text).toBe("Water pooling, @Priya");
    expect(filed?.journalEntries[0]?.mentions.map((m) => m.personId)).toEqual([
      11,
    ]);
    expect(fake.areas.map((a) => a.slug)).toContain("pump-house");
    expect(fake.incidentTypes.find((t) => t.id === 10)?.approved).toBe(false);
  });

  it("files with a summary alone, and the list refetches", async () => {
    const fake = writerFake();
    const runtime = await signedInRuntime(fake);
    const onFiled = jest.fn();
    await renderWithProviders(
      <NewIncidentScreen
        eventId={1}
        onCancel={() => undefined}
        onFiled={onFiled}
      />,
      runtime,
    );
    await fireEvent.changeText(screen.getByTestId("summary"), "Just this");
    await fireEvent.press(screen.getByTestId("file-incident"));
    await waitFor(() => expect(onFiled).toHaveBeenCalledWith(1));
    const filed = fake.incidents[0]?.incident;
    expect(filed?.priority).toBe(IncidentPriority.NORMAL);
    expect(filed?.incidentTypeIds).toEqual([]);
    expect(filed?.journalEntries).toEqual([]);
  });

  it("refuses an empty summary without a round trip", async () => {
    const fake = writerFake();
    const runtime = await signedInRuntime(fake);
    const onFiled = jest.fn();
    await renderWithProviders(
      <NewIncidentScreen
        eventId={1}
        onCancel={() => undefined}
        onFiled={onFiled}
      />,
      runtime,
    );
    await fireEvent.press(screen.getByTestId("file-incident"));
    expect(screen.getByText("Say what it is, in one line.")).toBeTruthy();
    expect(fake.callsOf("CreateIncident")).toHaveLength(0);
    expect(onFiled).not.toHaveBeenCalled();
  });

  it("keeps the form and shows the error when the server is unreachable", async () => {
    const fake = writerFake();
    fake.behaviour.createIncident = "unavailable";
    const runtime = await signedInRuntime(fake);
    const onFiled = jest.fn();
    await renderWithProviders(
      <NewIncidentScreen
        eventId={1}
        initialSummary="Keep me"
        onCancel={() => undefined}
        onFiled={onFiled}
      />,
      runtime,
    );
    await fireEvent.press(screen.getByTestId("file-incident"));
    await waitFor(() =>
      expect(screen.getByText("Can't reach the server")).toBeTruthy(),
    );
    expect(screen.getByTestId("summary").props.value).toBe("Keep me");
    expect(onFiled).not.toHaveBeenCalled();
  });

  it("restores an unsent draft with a note, and clears it on filing", async () => {
    await AsyncStorage.setItem(
      DRAFTS_KEY,
      JSON.stringify({ "1/new": { summary: "From before", text: "Notes" } }),
    );
    const fake = writerFake();
    const runtime = await signedInRuntime(fake);
    const onFiled = jest.fn();
    await renderWithProviders(
      <NewIncidentScreen
        eventId={1}
        onCancel={() => undefined}
        onFiled={onFiled}
      />,
      runtime,
    );
    await waitFor(() =>
      expect(screen.getByText("Restored an unsent draft.")).toBeTruthy(),
    );
    expect(screen.getByTestId("summary").props.value).toBe("From before");
    expect(screen.getByTestId("first-entry").props.value).toBe("Notes");
    await fireEvent.press(screen.getByTestId("file-incident"));
    await waitFor(() => expect(onFiled).toHaveBeenCalledWith(1));
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(DRAFTS_KEY)).toBe("{}"),
    );
  });
});
