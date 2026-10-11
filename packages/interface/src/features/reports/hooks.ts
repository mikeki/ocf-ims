// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";

// The report table's rows: every report the server answers the viewer
// (it scopes the list), journal entries included. The live hub invalidates
// `ListReports` on a report poke, so the rows follow without a poll; the
// refetch interval is the stream's fallback only.

const REPORTS_POLL_MS = 30_000;

export function useReportRows(eventId: number) {
  return useQuery(
    ImsService.method.listReports,
    { eventId, excludeSystemEntries: false },
    { refetchInterval: REPORTS_POLL_MS, retry: false },
  );
}
