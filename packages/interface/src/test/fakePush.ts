// SPDX-License-Identifier: Apache-2.0

import type { PushPermission, PushService } from "@/push/service";

// A programmable PushService (plan 09u): the permission answers are scripted,
// and a test can deliver a notification or a tap.

export interface FakePush extends PushService {
  current: PushPermission;
  /** What `request()` answers (and becomes `current`). */
  onRequest: PushPermission;
  tokenValue: string;
  requests: number;
  settingsOpened: number;
  launch: string | undefined;
  emitReceived(): void;
  emitOpened(url: string): void;
}

export function createFakePush(
  options: { available?: boolean; permission?: PushPermission } = {},
): FakePush {
  const received = new Set<() => void>();
  const opened = new Set<(url: string) => void>();
  const fake: FakePush = {
    available: options.available ?? true,
    current: options.permission ?? "undetermined",
    onRequest: "granted",
    tokenValue: "ExponentPushToken[fake]",
    requests: 0,
    settingsOpened: 0,
    launch: undefined,
    permission: async () => fake.current,
    request: async () => {
      fake.requests += 1;
      fake.current = fake.onRequest;
      return fake.current;
    },
    token: async () => fake.tokenValue,
    openSettings: () => {
      fake.settingsOpened += 1;
    },
    onReceived: (listener) => {
      received.add(listener);
      return () => received.delete(listener);
    },
    onOpened: (listener) => {
      opened.add(listener);
      return () => opened.delete(listener);
    },
    launchUrl: async () => {
      const url = fake.launch;
      fake.launch = undefined;
      return url;
    },
    emitReceived: () => {
      for (const l of received) {
        l();
      }
    },
    emitOpened: (url) => {
      for (const l of opened) {
        l(url);
      }
    },
  };
  return fake;
}
