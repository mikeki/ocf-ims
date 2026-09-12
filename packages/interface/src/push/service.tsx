// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

// The device's push surface (plan 09u), behind an interface so the app's
// composition supplies the Expo implementation and the tests a fake; nothing
// under features/ imports expo-notifications. Permission is asked from the
// Alerts screen at the person's tap, never on launch.

export type PushPermission = "undetermined" | "granted" | "denied";

export interface PushService {
  /** False on web, in a simulator, or in a build with no EAS project id — the card stays hidden. */
  readonly available: boolean;
  permission(): Promise<PushPermission>;
  request(): Promise<PushPermission>;
  /** The Expo push token for this device (`ExponentPushToken[…]`). */
  token(): Promise<string>;
  openSettings(): void;
  /** A notification arrived while the app was open. */
  onReceived(listener: () => void): () => void;
  /** A notification was tapped: the deep link the server put in `data.url`. */
  onOpened(listener: (url: string) => void): () => void;
  /** The tap that launched the app, if any; consumed by the call. */
  launchUrl(): Promise<string | undefined>;
}

export const nullPushService: PushService = {
  available: false,
  permission: async () => "undetermined",
  request: async () => "undetermined",
  token: async () => {
    throw new Error("push is not available here");
  },
  openSettings: () => undefined,
  onReceived: () => () => undefined,
  onOpened: () => () => undefined,
  launchUrl: async () => undefined,
};

const PushContext = createContext<PushService>(nullPushService);

export function PushProvider(props: {
  service: PushService;
  children: ReactNode;
}) {
  return (
    <PushContext.Provider value={props.service}>
      {props.children}
    </PushContext.Provider>
  );
}

export function usePush(): PushService {
  return useContext(PushContext);
}
