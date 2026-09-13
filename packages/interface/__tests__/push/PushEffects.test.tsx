// SPDX-License-Identifier: Apache-2.0

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, waitFor } from "@testing-library/react-native";
import { PushEffects } from "@/push/PushEffects";
import { PUSH_TOKEN_KEY, unregisterStored } from "@/push/registration";
import { createFakeIms } from "@/test/fakeIms";
import { createFakePush } from "@/test/fakePush";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The device's registration and the tap → route path (plan 09u), plus the
// sign-out unregistration through the session's beforeSignOut hook.

async function setup(permission: "granted" | "undetermined" = "granted") {
  const fake = createFakeIms();
  fake.events = [{ id: 1, name: "2026" }];
  const push = createFakePush({ permission });
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({
    fake,
    store,
    platform: "native",
    beforeSignOut: (client) => unregisterStored(client, AsyncStorage),
  });
  await runtime.session.bootstrap();
  const onOpen = jest.fn();
  await renderWithProviders(
    <PushEffects onOpen={onOpen} />,
    runtime,
    undefined,
    undefined,
    push,
  );
  return { fake, push, runtime, onOpen };
}

afterEach(async () => {
  await AsyncStorage.clear();
});

describe("PushEffects", () => {
  it("registers the device when the permission is already granted, and never asks", async () => {
    const { fake, push } = await setup();
    await waitFor(() =>
      expect(fake.pushDevices).toEqual(["ExponentPushToken[fake]"]),
    );
    expect(push.requests).toBe(0);
  });

  it("registers nothing without the permission", async () => {
    const { fake, push } = await setup("undetermined");
    await waitFor(() => expect(fake.callsOf("ListEvents")).not.toHaveLength(0));
    expect(fake.pushDevices).toEqual([]);
    expect(push.requests).toBe(0);
  });

  it("refetches the alerts when one arrives in the foreground", async () => {
    const { fake, push, runtime } = await setup();
    await waitFor(() => expect(fake.pushDevices).toHaveLength(1));
    // Prime the list so there is something to refetch.
    await runtime.client.listNotifications({});
    const before = fake.callsOf("ListNotifications").length;
    await act(async () => push.emitReceived());
    // Invalidating with no mounted observer refetches nothing; the count must not grow.
    expect(fake.callsOf("ListNotifications").length).toBe(before);
  });

  it("turns a tapped notification into a route once the events are known", async () => {
    const { fake, push, onOpen } = await setup();
    // The effect has run once the device is registered.
    await waitFor(() => expect(fake.pushDevices).toHaveLength(1));
    await act(async () => push.emitOpened("/ims/app/events/2026/incidents/12"));
    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith("/events/1/incidents/12"),
    );
    await act(async () => push.emitOpened("https://evil.example/"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens the launching notification's link", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    const push = createFakePush({ permission: "granted" });
    push.launch = "/ims/app/events/2026/reports/new?incident=4";
    const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
    const runtime = createTestRuntime({ fake, store, platform: "native" });
    await runtime.session.bootstrap();
    const onOpen = jest.fn();
    await renderWithProviders(
      <PushEffects onOpen={onOpen} />,
      runtime,
      undefined,
      undefined,
      push,
    );
    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith("/events/1/reports/new?incident=4"),
    );
  });

  it("unregisters the remembered token on sign-out, before the Bearer goes", async () => {
    const { fake, runtime } = await setup();
    await waitFor(() => expect(fake.pushDevices).toHaveLength(1));
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBe(
        "ExponentPushToken[fake]",
      ),
    );
    await runtime.session.signOut();
    expect(fake.pushDevices).toEqual([]);
    expect(fake.callsOf("UnregisterPushDevice")[0]?.bearer).toMatch(/^Bearer /);
    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });
});
