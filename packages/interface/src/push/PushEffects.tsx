// SPDX-License-Identifier: Apache-2.0

import { createClient } from "@connectrpc/connect";
import { useTransport } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { useInvalidateAlerts } from "@/features/alerts/hooks";
import { pushLinkHref } from "@/features/alerts/links";
import { useEvents } from "@/features/events/hooks";
import { registerIfGranted } from "@/push/registration";
import { usePush } from "@/push/service";

// Mounted once under the signed-in gate (plan 09u): registers the device
// when the permission already allows it, refetches the alerts when a
// notification arrives in the foreground, and turns a tapped notification
// (or the one that launched the app) into a route once the events list can
// name the event.

export interface PushEffectsProps {
  onOpen: (href: string) => void;
}

export function PushEffects(props: PushEffectsProps) {
  const { onOpen } = props;
  const push = usePush();
  const transport = useTransport();
  const client = useMemo(
    () => createClient(ImsService, transport),
    [transport],
  );
  const invalidate = useInvalidateAlerts();
  const { data } = useEvents();
  const [pendingUrl, setPendingUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!push.available) {
      return;
    }
    void registerIfGranted(push, client, AsyncStorage).catch(() => undefined);
    const offReceived = push.onReceived(() => {
      void invalidate();
    });
    const offOpened = push.onOpened((url) => setPendingUrl(url));
    void push
      .launchUrl()
      .then((url) => {
        if (url) {
          setPendingUrl(url);
        }
      })
      .catch(() => undefined);
    return () => {
      offReceived();
      offOpened();
    };
  }, [push, client, invalidate]);

  useEffect(() => {
    if (!pendingUrl || !data) {
      return;
    }
    const href = pushLinkHref(pendingUrl, data.events);
    setPendingUrl(undefined);
    if (href) {
      onOpen(href);
    }
  }, [pendingUrl, data, onOpen]);

  return null;
}
