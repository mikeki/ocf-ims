// SPDX-License-Identifier: Apache-2.0

import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { BoardScreen } from "@/features/board/BoardScreen";
import { EventsScreen } from "@/features/events/EventsScreen";
import { createFakeIms } from "@/test/fakeIms";
import { makeNotification } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The header's bell (plan 09u): the unread count, on the Board and the events list.

async function runtimeFor(unread: number) {
  const fake = createFakeIms();
  fake.events = [{ id: 1, name: "2026" }];
  fake.notifications = Array.from({ length: unread }, (_, i) =>
    makeNotification({ id: i + 1 }),
  );
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

describe("AlertsBell", () => {
  it("counts the unread on the Board and opens the alerts", async () => {
    const runtime = await runtimeFor(3);
    const onOpenAlerts = jest.fn();
    await renderWithProviders(
      <BoardScreen
        eventId={1}
        onBack={() => undefined}
        onOpenIncident={() => undefined}
        onOpenReport={() => undefined}
        onFile={() => undefined}
        onFileReport={() => undefined}
        onOpenAlerts={onOpenAlerts}
      />,
      runtime,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Alerts, 3 unread")).toBeTruthy(),
    );
    expect(screen.getByText("3")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("alerts-bell"));
    expect(onOpenAlerts).toHaveBeenCalledTimes(1);
  });

  it("is a bare word with nothing unread, on the events list", async () => {
    const runtime = await runtimeFor(0);
    await renderWithProviders(
      <EventsScreen
        onOpenEvent={() => undefined}
        onOpenAlerts={() => undefined}
      />,
      runtime,
    );
    await waitFor(() => expect(screen.getByLabelText("Alerts")).toBeTruthy());
    expect(screen.queryByText("0")).toBeNull();
  });
});
