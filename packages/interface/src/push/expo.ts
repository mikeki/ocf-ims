// SPDX-License-Identifier: Apache-2.0

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import {
  nullPushService,
  type PushPermission,
  type PushService,
} from "@/push/service";

// The Expo push implementation (plan 09u; the server side is 09p 3b.0c).
// Built once by the root layout. The foreground handler shows the banner and
// the list entry; no sound, no badge — the app's bell is the count.

function toPermission(
  status: Notifications.NotificationPermissionsStatus,
): PushPermission {
  if (status.granted) {
    return "granted";
  }
  return status.status === "denied" ? "denied" : "undetermined";
}

function urlOf(
  response: Notifications.NotificationResponse,
): string | undefined {
  const url = response.notification.request.content.data?.url;
  return typeof url === "string" ? url : undefined;
}

export function createExpoPushService(): PushService {
  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId;
  if (Platform.OS === "web" || !Device.isDevice || !projectId) {
    return nullPushService;
  }
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  return {
    available: true,
    permission: async () =>
      toPermission(await Notifications.getPermissionsAsync()),
    request: async () =>
      toPermission(await Notifications.requestPermissionsAsync()),
    token: async () =>
      (await Notifications.getExpoPushTokenAsync({ projectId })).data,
    openSettings: () => {
      void Linking.openSettings();
    },
    onReceived: (listener) => {
      const sub = Notifications.addNotificationReceivedListener(() =>
        listener(),
      );
      return () => sub.remove();
    },
    onOpened: (listener) => {
      const sub = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          const url = urlOf(response);
          if (url) {
            listener(url);
          }
        },
      );
      return () => sub.remove();
    },
    launchUrl: async () => {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (!response) {
        return undefined;
      }
      await Notifications.clearLastNotificationResponseAsync();
      return urlOf(response);
    },
  };
}
