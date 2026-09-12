// SPDX-License-Identifier: Apache-2.0

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { NewIncidentScreen } from "@/features/compose/NewIncidentScreen";
import { createFakeBlobs } from "@/test/fakeBlobs";
import { createFakeIms } from "@/test/fakeIms";
import { createFakePhotoPicker } from "@/test/fakePhotoPicker";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// A photo on the filing form (plan 09s, Q2): the incident is filed first,
// then the photo goes to its number; when that upload fails the form stays
// with Retry and "Continue without it".

async function mount() {
  const fake = createFakeIms({ user: { writeIncidents: true } });
  fake.events = [{ id: 1, name: "Fair 2026" }];
  const blobs = createFakeBlobs();
  const picker = createFakePhotoPicker(false);
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native", blobs });
  await runtime.session.bootstrap();
  const onFiled = jest.fn();
  await renderWithProviders(
    <NewIncidentScreen
      eventId={1}
      onCancel={() => undefined}
      onFiled={onFiled}
    />,
    runtime,
    undefined,
    picker,
  );
  await waitFor(() => expect(screen.getByTestId("photo-add")).toBeTruthy());
  return { fake, blobs, picker, onFiled };
}

afterEach(async () => {
  await AsyncStorage.clear();
});

describe("NewIncidentScreen with a photo", () => {
  it("files, then uploads to the new number, then leaves", async () => {
    const { fake, blobs, picker, onFiled } = await mount();
    // No camera on web: the tap goes straight to the library.
    await fireEvent.press(screen.getByTestId("photo-add"));
    expect(picker.picks).toEqual(["library"]);
    await waitFor(() => expect(screen.getByTestId("photo-chip")).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId("summary"), "Pump leaking");
    await fireEvent.press(screen.getByTestId("file-incident"));
    await waitFor(() => expect(onFiled).toHaveBeenCalledTimes(1));
    const number = onFiled.mock.calls[0]?.[0];
    expect(fake.incidents.map((v) => v.incident?.number)).toContain(number);
    expect(blobs.uploads).toHaveLength(1);
    expect(blobs.uploads[0]).toMatchObject({ eventName: "Fair 2026", number });
  });

  it("stays with two ways out when the photo does not land", async () => {
    const { blobs, onFiled } = await mount();
    blobs.behaviour.upload = "unavailable";
    await fireEvent.press(screen.getByTestId("photo-add"));
    await waitFor(() => expect(screen.getByTestId("photo-chip")).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId("summary"), "Pump leaking");
    await fireEvent.press(screen.getByTestId("file-incident"));
    await waitFor(() =>
      expect(screen.getByTestId("filed-without-photo")).toBeTruthy(),
    );
    expect(onFiled).not.toHaveBeenCalled();
    expect(screen.getByTestId("photo-retry")).toBeTruthy();
    // Retry lands it and the form leaves.
    blobs.behaviour.upload = "ok";
    await fireEvent.press(screen.getByTestId("photo-retry"));
    await waitFor(() => expect(onFiled).toHaveBeenCalledTimes(1));
    expect(blobs.uploads).toHaveLength(2);
    expect(blobs.uploads[1]?.number).toBe(blobs.uploads[0]?.number);
  });

  it("lets the caller continue without the photo", async () => {
    const { blobs, onFiled } = await mount();
    blobs.behaviour.upload = "unavailable";
    await fireEvent.press(screen.getByTestId("photo-add"));
    await waitFor(() => expect(screen.getByTestId("photo-chip")).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId("summary"), "Pump leaking");
    await fireEvent.press(screen.getByTestId("file-incident"));
    await waitFor(() =>
      expect(screen.getByTestId("continue-without-photo")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("continue-without-photo"));
    expect(onFiled).toHaveBeenCalledWith(blobs.uploads[0]?.number);
  });
});
