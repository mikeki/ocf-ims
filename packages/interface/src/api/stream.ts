// SPDX-License-Identifier: Apache-2.0

import { Code, ConnectError } from "@connectrpc/connect";
import type { WatchEventResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/stream_pb";
import type { ImsClient } from "@/api/client";

// The client half of WatchEvent (plan 09v; the server is 09p 3b.0b): one
// long-lived server stream per watched event, reopened with backoff when it
// drops, declared stale when two heartbeats go missing. It runs through the
// auth transport, so the Bearer and the proactive refresh are the
// interceptor's; an Unauthenticated end (the token expired mid-stream — 09p
// Q4) is just a drop, and the next attempt carries a refreshed token.
// Anything the caller must refetch is reported through `onOpen(gap)`: the
// stream itself carries pokes, never content.

export interface StreamHandlers {
  onPoke(response: WatchEventResponse): void;
  /** The stream is established. `gap` = a previous stream had dropped, so anything may have changed. */
  onOpen(gap: boolean): void;
  /** The stream ended or failed; the loop is backing off. */
  onDrop?(error: ConnectError | undefined): void;
}

export interface WatchOptions {
  eventIds: number[];
  signal: AbortSignal;
  /** Two heartbeats (25 s each) missed. */
  staleMs?: number;
  /** Injected for tests: an interruptible delay. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

export const STREAM_STALE_MS = 60_000;
export const STREAM_BACKOFF_MIN_MS = 1_000;
export const STREAM_BACKOFF_MAX_MS = 30_000;

export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Full jitter: a random delay up to the capped exponential. */
export function backoffMs(attempt: number, random: () => number): number {
  const cap = Math.min(
    STREAM_BACKOFF_MAX_MS,
    STREAM_BACKOFF_MIN_MS * 2 ** attempt,
  );
  return Math.floor(
    STREAM_BACKOFF_MIN_MS + random() * (cap - STREAM_BACKOFF_MIN_MS),
  );
}

/** Resolves when `options.signal` aborts; never rejects. */
export async function watchEvents(
  client: ImsClient,
  options: WatchOptions,
  handlers: StreamHandlers,
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const staleMs = options.staleMs ?? STREAM_STALE_MS;
  let attempt = 0;
  let everOpened = false;

  while (!options.signal.aborted) {
    const attemptController = new AbortController();
    const onOuterAbort = () => attemptController.abort();
    options.signal.addEventListener("abort", onOuterAbort, { once: true });
    let stale: ReturnType<typeof setTimeout> | undefined;
    const armStale = () => {
      clearTimeout(stale);
      stale = setTimeout(() => attemptController.abort(), staleMs);
    };
    let opened = false;
    let failure: ConnectError | undefined;
    try {
      armStale();
      for await (const response of client.watchEvent(
        { eventIds: options.eventIds },
        { signal: attemptController.signal },
      )) {
        armStale();
        if (!opened) {
          opened = true;
          attempt = 0;
          handlers.onOpen(everOpened);
          everOpened = true;
        }
        handlers.onPoke(response);
      }
    } catch (e) {
      const err = ConnectError.from(e);
      // Our own abort (stale, background, unmount) is not a failure to report.
      failure = err.code === Code.Canceled ? undefined : err;
    } finally {
      clearTimeout(stale);
      options.signal.removeEventListener("abort", onOuterAbort);
    }
    if (options.signal.aborted) {
      return;
    }
    handlers.onDrop?.(failure);
    await sleep(backoffMs(attempt, random), options.signal);
    attempt += 1;
  }
}
