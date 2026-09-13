// SPDX-License-Identifier: Apache-2.0

import {
  createConnectQueryKey,
  useMutation,
  useQuery,
  useTransport,
} from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

// The alerts' data (plan 09u): one ListNotifications for the list and the
// bell's count, polled while mounted (the live stream is 3b.6); marking read
// refetches it — the server's `read` is the truth, no local watermark here.

const ALERTS_POLL_MS = 30_000;

export function useAlerts() {
  return useQuery(
    ImsService.method.listNotifications,
    {},
    { refetchInterval: ALERTS_POLL_MS },
  );
}

/** Refetch the list after a write, from any hook that changes what it shows. */
export function useInvalidateAlerts() {
  const transport = useTransport();
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: ImsService.method.listNotifications,
          transport,
          cardinality: "finite",
        }),
      }),
    [queryClient, transport],
  );
}

export function useMarkAlertRead() {
  const invalidate = useInvalidateAlerts();
  return useMutation(ImsService.method.markNotificationRead, {
    onSettled: () => invalidate(),
  });
}

export function useMarkAllAlertsRead() {
  const invalidate = useInvalidateAlerts();
  return useMutation(ImsService.method.markAllNotificationsRead, {
    onSettled: () => invalidate(),
  });
}
