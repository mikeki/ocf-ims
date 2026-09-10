// SPDX-License-Identifier: Apache-2.0

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen } from "@testing-library/react-native";
import { EventsScreen } from "@/features/events/EventsScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// EventsScreen against the real runtime (plan 09n): the fake starts the
// caller signed out, so every test signs in with a stored refresh token
// (native) the way the (app) layout would find a session already bootstrapped.

function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  return createTestRuntime({ fake, store, platform: "native" });
}

describe("EventsScreen", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("lists events newest first, badges the current one, and opens on press", async () => {
    const fake = createFakeIms();
    fake.events = [
      { id: 1, name: "2025" },
      { id: 2, name: "2026" },
    ];
    const runtime = signedInRuntime(fake);
    const onOpenEvent = jest.fn();

    await renderWithProviders(
      <EventsScreen onOpenEvent={onOpenEvent} />,
      runtime,
    );

    await screen.findByTestId("event-row-2");
    const rows = screen.getAllByTestId(/^event-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual([
      "event-row-2",
      "event-row-1",
    ]);
    screen.getByText("Current");

    await fireEvent.press(screen.getByTestId("event-row-1"));
    expect(onOpenEvent).toHaveBeenCalledWith(1);
  });

  it("badges a remembered event that isn't the newest as Last opened", async () => {
    const fake = createFakeIms();
    fake.events = [
      { id: 1, name: "2025" },
      { id: 2, name: "2026" },
    ];
    const runtime = signedInRuntime(fake);

    await renderWithProviders(
      <EventsScreen onOpenEvent={jest.fn()} />,
      runtime,
    );
    await screen.findByTestId("event-row-2");

    await fireEvent.press(screen.getByTestId("event-row-1"));

    await screen.findByText("Last opened");
    screen.getByText("Current");
  });

  it("shows the empty state with no events", async () => {
    const fake = createFakeIms();
    fake.events = [];
    const runtime = signedInRuntime(fake);

    await renderWithProviders(
      <EventsScreen onOpenEvent={jest.fn()} />,
      runtime,
    );

    await screen.findByText("No events yet");
  });

  it("shows an error with retry when the list fails", async () => {
    const fake = createFakeIms();
    fake.behaviour.listEvents = "unavailable";
    const runtime = signedInRuntime(fake);

    await renderWithProviders(
      <EventsScreen onOpenEvent={jest.fn()} />,
      runtime,
    );

    await screen.findByText("Can't reach the server");
    screen.getByRole("button", { name: "Retry" });
  });

  it("shows who is signed in and signs out from the footer", async () => {
    const fake = createFakeIms();
    const runtime = signedInRuntime(fake);

    await renderWithProviders(
      <EventsScreen onOpenEvent={jest.fn()} />,
      runtime,
    );

    await screen.findByText(`Signed in as ${fake.user.handle}`);
    await fireEvent.press(screen.getByText("Sign out"));
    expect(fake.callsOf("Logout")).toHaveLength(1);
  });
});
