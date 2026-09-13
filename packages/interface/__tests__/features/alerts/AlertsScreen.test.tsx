// SPDX-License-Identifier: Apache-2.0

import { NotificationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/notification_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AlertsScreen } from "@/features/alerts/AlertsScreen";
import { PUSH_TOKEN_KEY } from "@/push/registration";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { createFakePush, type FakePush } from "@/test/fakePush";
import { makeNotification } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The alerts (plan 09u): the list, a tap that marks read and opens, mark all,
// and the push card's three states.

function alertsFake() {
  const fake = createFakeIms();
  fake.events = [{ id: 1, name: "2026" }];
  fake.notifications = [
    makeNotification({ id: 1 }),
    makeNotification({
      id: 2,
      type: NotificationType.REPORT_REQUESTED,
      actor: "Dee",
      read: true,
    }),
  ];
  return fake;
}

async function mount(fake: FakeIms, push?: FakePush) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  const onOpen = jest.fn();
  await renderWithProviders(
    <AlertsScreen onBack={() => undefined} onOpen={onOpen} />,
    runtime,
    undefined,
    undefined,
    push,
  );
  return { onOpen };
}

afterEach(async () => {
  await AsyncStorage.clear();
});

describe("AlertsScreen", () => {
  it("lists the alerts with the unread mark, and a tap marks one read and opens it", async () => {
    const fake = alertsFake();
    const { onOpen } = await mount(fake);
    await waitFor(() => expect(screen.getByTestId("alert-row-1")).toBeTruthy());
    expect(screen.getByText("Marisol mentioned you")).toBeTruthy();
    expect(
      screen.getByText("Dee asked for your report on an incident"),
    ).toBeTruthy();
    expect(screen.getAllByLabelText("Unread")).toHaveLength(1);
    await fireEvent.press(screen.getByTestId("alert-row-1"));
    expect(onOpen).toHaveBeenCalledWith("/events/1/incidents/12");
    await waitFor(() => expect(fake.notifications[0]?.read).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText("Unread")).toBeNull());
    expect(screen.queryByTestId("alerts-mark-all")).toBeNull();
  });

  it("opens the report form for a request, without a second mark on a read one", async () => {
    const fake = alertsFake();
    const { onOpen } = await mount(fake);
    await waitFor(() => expect(screen.getByTestId("alert-row-2")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("alert-row-2"));
    expect(onOpen).toHaveBeenCalledWith("/events/1/reports/new?incident=12");
    expect(fake.callsOf("MarkNotificationRead")).toHaveLength(0);
  });

  it("marks all read from the header", async () => {
    const fake = alertsFake();
    await mount(fake);
    await waitFor(() =>
      expect(screen.getByTestId("alerts-mark-all")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("alerts-mark-all"));
    await waitFor(() =>
      expect(screen.queryByTestId("alerts-mark-all")).toBeNull(),
    );
    expect(fake.notifications.every((n) => n.read)).toBe(true);
  });

  it("has an empty state", async () => {
    const fake = alertsFake();
    fake.notifications = [];
    await mount(fake);
    await waitFor(() => expect(screen.getByText("No alerts yet")).toBeTruthy());
  });

  it("asks for the permission at the tap and registers the device on a yes", async () => {
    const fake = alertsFake();
    const push = createFakePush();
    await mount(fake, push);
    await waitFor(() => expect(screen.getByTestId("push-enable")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("push-enable"));
    await waitFor(() =>
      expect(fake.pushDevices).toEqual(["ExponentPushToken[fake]"]),
    );
    expect(push.requests).toBe(1);
    await waitFor(() => expect(screen.queryByTestId("push-card")).toBeNull());
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBe(
      "ExponentPushToken[fake]",
    );
  });

  it("points at Settings after a denial, and registers nothing", async () => {
    const fake = alertsFake();
    const push = createFakePush();
    push.onRequest = "denied";
    await mount(fake, push);
    await waitFor(() => expect(screen.getByTestId("push-enable")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("push-enable"));
    await waitFor(() =>
      expect(screen.getByTestId("push-card-denied")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("push-settings"));
    expect(push.settingsOpened).toBe(1);
    expect(fake.pushDevices).toEqual([]);
  });

  it("shows no card where push is unavailable or already on", async () => {
    const fake = alertsFake();
    await mount(fake, createFakePush({ available: false }));
    await waitFor(() => expect(screen.getByTestId("alert-row-1")).toBeTruthy());
    expect(screen.queryByTestId("push-card")).toBeNull();
    // The default context is the null service, so a screen without a provider has no card either.
    await mount(alertsFake(), createFakePush({ permission: "granted" }));
    expect(screen.queryByTestId("push-card")).toBeNull();
  });
});
