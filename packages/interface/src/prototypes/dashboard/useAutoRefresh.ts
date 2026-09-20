// SPDX-License-Identifier: Apache-2.0

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import type { AsyncStorageLike } from "@/api/persist";

// The dashboard's auto-refresh preference (docs/plans/09ab-dashboard-design.md
// § The refresh model): Off · 30 s · 1 min · 5 min, remembered per device,
// default Off — the same load/save-over-AsyncStorageLike shape as
// features/dispatch/statePreference.ts, wrapped in try/catch per the brief
// (a storage failure falls back to Off rather than throwing).

export type AutoRefresh = "off" | "30s" | "1m" | "5m";

export const AUTO_REFRESH_KEY = "dashboard.autoRefresh";

export const AUTO_REFRESH_OPTIONS: { key: AutoRefresh; label: string }[] = [
  { key: "off", label: "Off" },
  { key: "30s", label: "30 s" },
  { key: "1m", label: "1 min" },
  { key: "5m", label: "5 min" },
];

/** The interval `useMetrics`' `refetchInterval` reads; `false` means never. */
export function intervalMsFor(pref: AutoRefresh): number | false {
  switch (pref) {
    case "30s":
      return 30_000;
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    default:
      return false;
  }
}

async function load(storage: AsyncStorageLike): Promise<AutoRefresh> {
  try {
    const raw = await storage.getItem(AUTO_REFRESH_KEY);
    return raw === "30s" || raw === "1m" || raw === "5m" ? raw : "off";
  } catch {
    return "off";
  }
}

async function save(
  storage: AsyncStorageLike,
  value: AutoRefresh,
): Promise<void> {
  try {
    await storage.setItem(AUTO_REFRESH_KEY, value);
  } catch {
    // Best-effort — the in-memory preference still applies this session.
  }
}

export interface UseAutoRefreshResult {
  preference: AutoRefresh;
  intervalMs: number | false;
  setPreference: (value: AutoRefresh) => void;
}

export function useAutoRefresh(): UseAutoRefreshResult {
  const [preference, setPreferenceState] = useState<AutoRefresh>("off");

  useEffect(() => {
    let cancelled = false;
    void load(AsyncStorage).then((value) => {
      if (!cancelled) {
        setPreferenceState(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((value: AutoRefresh) => {
    setPreferenceState(value);
    void save(AsyncStorage, value);
  }, []);

  return { preference, intervalMs: intervalMsFor(preference), setPreference };
}
