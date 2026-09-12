// SPDX-License-Identifier: Apache-2.0

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { IncidentScreen } from "@/features/incidents/IncidentScreen";
import { createFakeBlobs } from "@/test/fakeBlobs";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { createFakePhotoPicker } from "@/test/fakePhotoPicker";
import {
  makeIncident,
  makeIncidentView,
  makeJournalEntry,
} from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The photo on the docked composer (plan 09s, slice 3b.4b), through the
// incident screen: the chip, its removal, the send order (text first, then
// the upload), a failed upload keeping the chip with Retry, and the control's
// absence when the caller may not attach.

function attacherFake(attachFiles = true) {
  const fake = createFakeIms({ user: { attachFiles } });
  fake.events = [{ id: 1, name: "Fair 2026" }];
  fake.incidents = [
    makeIncidentView({
      viewerMayAddJournal: true,
      incident: makeIncident({
        eventId: 1,
        number: 214,
        summary: "Lost child",
        journalEntries: [makeJournalEntry({ id: 1, text: "First" })],
      }),
    }),
  ];
  return fake;
}

async function mount(fake: FakeIms) {
  const blobs = createFakeBlobs();
  const picker = createFakePhotoPicker();
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native", blobs });
  await runtime.session.bootstrap();
  await renderWithProviders(
    <IncidentScreen
      eventId={1}
      number={214}
      onBack={() => undefined}
      onOpenIncident={() => undefined}
      onOpenReport={() => undefined}
      onFileReport={() => undefined}
      onOpenAttachment={() => undefined}
    />,
    runtime,
    undefined,
    picker,
  );
  await waitFor(() => expect(screen.getByTestId("append-text")).toBeTruthy());
  return { blobs, picker };
}

async function pickFromLibrary() {
  await fireEvent.press(screen.getByTestId("photo-add"));
  await fireEvent.press(screen.getByTestId("photo-library"));
  await waitFor(() => expect(screen.getByTestId("photo-chip")).toBeTruthy());
}

afterEach(async () => {
  await AsyncStorage.clear();
});

describe("the photo on the AppendComposer", () => {
  it("shows a shrunken chip after a pick, and Remove takes it away", async () => {
    const { picker } = await mount(attacherFake());
    await pickFromLibrary();
    expect(picker.picks).toEqual(["library"]);
    expect(picker.shrunk).toHaveLength(1);
    expect(screen.getByText("Photo ready to send")).toBeTruthy();
    expect(screen.queryByTestId("photo-add")).toBeNull();
    await fireEvent.press(screen.getByTestId("photo-remove"));
    expect(screen.queryByTestId("photo-chip")).toBeNull();
    expect(screen.getByTestId("photo-add")).toBeTruthy();
  });

  it("sends the text first, then uploads the shrunken photo to the event-name route", async () => {
    const fake = attacherFake();
    const { blobs } = await mount(fake);
    await pickFromLibrary();
    await fireEvent.changeText(screen.getByTestId("append-text"), "Found her");
    await fireEvent.press(screen.getByTestId("append-send"));
    await waitFor(() => expect(blobs.uploads).toHaveLength(1));
    expect(fake.updateRequests).toHaveLength(1);
    expect(blobs.uploads[0]).toMatchObject({
      eventName: "Fair 2026",
      number: 214,
      file: { name: "IMG_0001.jpg", type: "image/jpeg" },
    });
    await waitFor(() => expect(screen.queryByTestId("photo-chip")).toBeNull());
    expect(screen.getByTestId("append-text").props.value).toBe("");
  });

  it("sends a photo alone", async () => {
    const fake = attacherFake();
    const { blobs } = await mount(fake);
    expect(
      screen.getByTestId("append-send").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    await pickFromLibrary();
    await fireEvent.press(screen.getByTestId("append-send"));
    await waitFor(() => expect(blobs.uploads).toHaveLength(1));
    expect(fake.updateRequests).toHaveLength(0);
  });

  it("keeps the chip with the server's words and Retry when the upload fails; the text is not resent", async () => {
    const fake = attacherFake();
    const { blobs } = await mount(fake);
    blobs.behaviour.upload = "tooLarge";
    await pickFromLibrary();
    await fireEvent.changeText(screen.getByTestId("append-text"), "Big one");
    await fireEvent.press(screen.getByTestId("append-send"));
    await waitFor(() => expect(screen.getByTestId("photo-retry")).toBeTruthy());
    expect(screen.getByText(/exceeds the 50 MiB limit/)).toBeTruthy();
    expect(fake.updateRequests).toHaveLength(1);
    blobs.behaviour.upload = "ok";
    await fireEvent.press(screen.getByTestId("photo-retry"));
    await waitFor(() => expect(screen.queryByTestId("photo-chip")).toBeNull());
    expect(blobs.uploads).toHaveLength(2);
    expect(fake.updateRequests).toHaveLength(1);
  });

  it("says so inline when the permission is denied", async () => {
    const { picker } = await mount(attacherFake());
    picker.next = { kind: "denied" };
    await fireEvent.press(screen.getByTestId("photo-add"));
    await fireEvent.press(screen.getByTestId("photo-camera"));
    await waitFor(() =>
      expect(screen.getByTestId("photo-denied")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("photo-settings"));
    expect(picker.settingsOpened).toBe(1);
  });

  it("is absent when the caller may not attach files", async () => {
    await mount(attacherFake(false));
    expect(screen.queryByTestId("photo-add")).toBeNull();
  });
});
