// SPDX-License-Identifier: Apache-2.0

import type { ImsClient } from "@/api/client";
import type { AsyncStorageLike } from "@/api/persist";
import type { PushPermission, PushService } from "@/push/service";

// Registering this device with the server (plan 09u): the token goes up on
// every sign-in the permission allows (the server upserts on it), is
// remembered on the device, and is unregistered on sign-out while the
// Bearer is still good. Every step is best-effort: push never blocks a
// session.

export const PUSH_TOKEN_KEY = "ocf-ims/push-token";

/** Registers when the permission is already granted; never asks. */
export async function registerIfGranted(
  push: PushService,
  client: ImsClient,
  storage: AsyncStorageLike,
): Promise<boolean> {
  if (!push.available) {
    return false;
  }
  if ((await push.permission()) !== "granted") {
    return false;
  }
  const token = await push.token();
  await client.registerPushDevice({ expoPushToken: token });
  await storage.setItem(PUSH_TOKEN_KEY, token).catch(() => undefined);
  return true;
}

/** The Alerts screen's button: ask, then register on a yes. */
export async function enablePush(
  push: PushService,
  client: ImsClient,
  storage: AsyncStorageLike,
): Promise<PushPermission> {
  const permission = await push.request();
  if (permission === "granted") {
    await registerIfGranted(push, client, storage);
  }
  return permission;
}

/** Sign-out: tell the server this device is no longer the person's, then forget the token. */
export async function unregisterStored(
  client: ImsClient,
  storage: AsyncStorageLike,
): Promise<void> {
  const token = await storage.getItem(PUSH_TOKEN_KEY).catch(() => null);
  if (!token) {
    return;
  }
  await client.unregisterPushDevice({ expoPushToken: token }).then(
    () => undefined,
    () => undefined,
  );
  await storage.removeItem(PUSH_TOKEN_KEY).catch(() => undefined);
}
