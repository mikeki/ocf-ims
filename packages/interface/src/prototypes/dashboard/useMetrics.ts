// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import type { Metrics } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/metrics_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toAppError } from "@/api/errors";

// The promotable dashboard read (docs/plans/09ab-dashboard-design.md § One
// read): one GetMetrics, polled at the caller's auto-refresh interval
// (useAutoRefresh.ts), keeping the previous frame on every refetch (§ The
// refresh model: "a refetch keeps the frame — the previous numbers stay,
// nothing blanks") and tracking which cards moved since the last successful
// answer for the changed mark (§ What changed).

export type ChangedKey =
  | "total"
  | "open"
  | "closed"
  | "avg"
  | "priority"
  | "category"
  | "type"
  | "area"
  | "day"
  | "roles"
  | "followUps";

/** How long a changed mark stays once nothing newer has arrived. */
const CHANGED_TTL_MS = 60_000;

interface KeyedCount {
  key: string;
  count: bigint;
}

function countsChanged(
  a: readonly KeyedCount[],
  b: readonly KeyedCount[],
): boolean {
  if (a.length !== b.length) {
    return true;
  }
  const prior = new Map(a.map((c) => [c.key, c.count]));
  return b.some((c) => prior.get(c.key) !== c.count);
}

function daysChanged(
  a: readonly { date: string; count: bigint }[],
  b: readonly { date: string; count: bigint }[],
): boolean {
  if (a.length !== b.length) {
    return true;
  }
  const prior = new Map(a.map((d) => [d.date, d.count]));
  return b.some((d) => prior.get(d.date) !== d.count);
}

function followUpsChanged(
  a: readonly { incidentNumber: number; summary: string }[],
  b: readonly { incidentNumber: number; summary: string }[],
): boolean {
  if (a.length !== b.length) {
    return true;
  }
  const prior = new Map(a.map((f) => [f.incidentNumber, f.summary]));
  return b.some((f) => prior.get(f.incidentNumber) !== f.summary);
}

/** Every field that moved between two successful answers, by changed-mark key. */
function diff(previous: Metrics, next: Metrics): Set<ChangedKey> {
  const out = new Set<ChangedKey>();
  if (previous.total !== next.total) {
    out.add("total");
  }
  if (previous.open !== next.open) {
    out.add("open");
  }
  if (previous.closed !== next.closed) {
    out.add("closed");
  }
  if (
    previous.avgTimeToCloseSeconds !== next.avgTimeToCloseSeconds ||
    previous.closedCount !== next.closedCount
  ) {
    out.add("avg");
  }
  if (countsChanged(previous.byPriority, next.byPriority)) {
    out.add("priority");
  }
  if (countsChanged(previous.byCategory, next.byCategory)) {
    out.add("category");
  }
  if (countsChanged(previous.byType, next.byType)) {
    out.add("type");
  }
  if (countsChanged(previous.byArea, next.byArea)) {
    out.add("area");
  }
  if (daysChanged(previous.byDay, next.byDay)) {
    out.add("day");
  }
  if (countsChanged(previous.byRole, next.byRole)) {
    out.add("roles");
  }
  if (followUpsChanged(previous.openFollowUps, next.openFollowUps)) {
    out.add("followUps");
  }
  return out;
}

export interface UseMetricsResult {
  metrics: Metrics | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  lastError: string | undefined;
  /** The card keys that moved since the last successful refresh, or in the last 60 s. */
  changedKeys: ReadonlySet<ChangedKey>;
  refresh: () => void;
}

/** `intervalMs` is `useAutoRefresh()`'s own `intervalMs` — `false` polls never. */
export function useMetrics(
  eventId: number,
  intervalMs: number | false,
): UseMetricsResult {
  const query = useQuery(
    ImsService.method.getMetrics,
    { eventId },
    {
      refetchInterval: intervalMs,
      refetchOnWindowFocus: true,
      placeholderData: keepPreviousData,
    },
  );

  const metrics = query.data?.metrics;
  const previousRef = useRef<Metrics | undefined>(undefined);
  const [changedKeys, setChangedKeys] = useState<ReadonlySet<ChangedKey>>(
    new Set(),
  );
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Recomputed fresh on every successful answer, so the marks from a stale
  // refresh never survive into the next one (cleared "on the next successful
  // refresh", per the brief, even when that refresh changed nothing itself).
  useEffect(() => {
    if (!metrics) {
      return;
    }
    const previous = previousRef.current;
    previousRef.current = metrics;
    if (!previous || previous === metrics) {
      return;
    }
    const next = diff(previous, metrics);
    setChangedKeys(next);
    clearTimeout(clearTimer.current);
    if (next.size > 0) {
      clearTimer.current = setTimeout(
        () => setChangedKeys(new Set()),
        CHANGED_TTL_MS,
      );
    }
  }, [metrics]);

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  return {
    metrics,
    isLoading: query.isLoading,
    isRefreshing: query.isFetching,
    lastError: query.isError ? toAppError(query.error).message : undefined,
    changedKeys,
    refresh: () => {
      void query.refetch();
    },
  };
}
