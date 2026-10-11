// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import type { Metrics } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/metrics_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type AppError, toAppError } from "@/api/errors";

// The dashboard read (docs/plans/09ab-dashboard-design.md § One read): one
// GetMetrics, polled at the caller's auto-refresh interval (useAutoRefresh.ts),
// keeping the previous frame on every refetch (§ The refresh model: "a refetch
// keeps the frame — the previous numbers stay, nothing blanks") and tracking
// which cards moved since the last successful answer for the changed mark
// (§ What changed). The live hub's pokes never reach it: the server caches the
// aggregate for a minute anyway.

/** `useAutoRefresh()`'s `intervalMs`: a period in milliseconds, or `false` for never. */
export type MetricsInterval = number | false;

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
  /** The failure of a first load, when there is no data to keep showing. */
  error: AppError | undefined;
  /** The last refetch's failure while the previous answer is still held; cleared by the next success. */
  lastError: AppError | undefined;
  /** The card keys that moved between the last two successful answers, until the next success or 60 s. */
  changedKeys: ReadonlySet<ChangedKey>;
  refresh: () => void;
}

export function useMetrics(
  eventId: number,
  intervalMs: MetricsInterval,
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
  const held = metrics !== undefined;
  const previousRef = useRef<{ eventId: number; metrics: Metrics } | undefined>(
    undefined,
  );
  const [changedKeys, setChangedKeys] = useState<ReadonlySet<ChangedKey>>(
    new Set(),
  );
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // Recomputed on every successful answer (keyed on dataUpdatedAt, so an
  // answer identical to the last still clears the old marks), never on the
  // previous event's frame shown as a placeholder.
  useEffect(() => {
    if (!metrics || query.isPlaceholderData || query.dataUpdatedAt === 0) {
      return;
    }
    const previous = previousRef.current;
    previousRef.current = { eventId, metrics };
    clearTimeout(clearTimer.current);
    if (!previous || previous.eventId !== eventId) {
      setChangedKeys(new Set());
      return;
    }
    const next = diff(previous.metrics, metrics);
    setChangedKeys(next);
    if (next.size > 0) {
      clearTimer.current = setTimeout(
        () => setChangedKeys(new Set()),
        CHANGED_TTL_MS,
      );
    }
  }, [metrics, eventId, query.isPlaceholderData, query.dataUpdatedAt]);

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  const failure = query.isError ? toAppError(query.error) : undefined;
  const { refetch } = query;
  return {
    metrics,
    isLoading: query.isLoading,
    isRefreshing: query.isFetching,
    error: held ? undefined : failure,
    lastError: held ? failure : undefined,
    changedKeys,
    refresh: () => {
      void refetch();
    },
  };
}
