// SPDX-License-Identifier: Apache-2.0

import { createClient } from "@connectrpc/connect";
import { useTransport } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { enablePush } from "@/push/registration";
import { type PushPermission, usePush } from "@/push/service";

// The Alerts screen's push card (plan 09u): the one place the permission is
// asked, at a tap. Hidden where push is unavailable and once it is on; a
// denial points at Settings, since the OS will not ask twice.

export function PushCard() {
  const push = usePush();
  const transport = useTransport();
  const client = useMemo(
    () => createClient(ImsService, transport),
    [transport],
  );
  const [permission, setPermission] = useState<PushPermission | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!push.available) {
      return;
    }
    let cancelled = false;
    void push
      .permission()
      .then((p) => {
        if (!cancelled) {
          setPermission(p);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [push]);

  if (!push.available || permission === undefined || permission === "granted") {
    return null;
  }

  if (permission === "denied") {
    return (
      <Box p="lg" gap="sm" bg="surface" testID="push-card-denied">
        <Text variant="caption" color="textMuted">
          Notifications are off for OCF IMS in this phone's settings.
        </Text>
        <TextButton
          label="Open settings"
          onPress={push.openSettings}
          testID="push-settings"
        />
      </Box>
    );
  }

  return (
    <Box p="lg" gap="sm" bg="surface" testID="push-card">
      <Text variant="heading">Get alerts on this phone</Text>
      <Text variant="caption" color="textMuted">
        A mention, an incident you are added to, or a request for your report
        reaches you even when the app is closed.
      </Text>
      <Button
        label="Turn on notifications"
        loading={busy}
        onPress={() => {
          setBusy(true);
          void enablePush(push, client, AsyncStorage)
            .then(setPermission)
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
        testID="push-enable"
      />
    </Box>
  );
}
