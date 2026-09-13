// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useLiveHub } from "@/api/providers";

// A screen's claim on an event's live stream (plan 09v): held while mounted,
// shared with every other screen on the same event. Returns whether the
// stream is open right now.

export function useLiveEvent(eventId: number): boolean {
  const hub = useLiveHub();
  useEffect(() => hub.watch(eventId), [hub, eventId]);
  const read = useCallback(() => hub.isLive(eventId), [hub, eventId]);
  return useSyncExternalStore(hub.subscribe, read, read);
}
