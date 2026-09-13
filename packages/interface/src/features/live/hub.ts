// SPDX-License-Identifier: Apache-2.0

import type { DescMethodUnary, MessageInitShape } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { createConnectQueryKey } from "@connectrpc/connect-query";
import { EventPokeKind } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/stream_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import type { QueryClient } from "@tanstack/react-query";
import type { ImsClient } from "@/api/client";
import { type WatchOptions, watchEvents } from "@/api/stream";

// The live hub (plan 09v): one WatchEvent stream per event while any screen
// watches it, shared by reference count; paused when the app leaves the
// foreground and reopened — with a full refetch — when it returns. A poke
// invalidates the record it names and the list it sits in; the screens'
// queries refetch through the access-gated reads, as they always did. The
// 30 s polls stay as the fallback for a stream that will not open.

export interface LiveHub {
  /** Watch an event; returns the release. */
  watch(eventId: number): () => void;
  /** Foreground/background. */
  setActive(active: boolean): void;
  isLive(eventId: number): boolean;
  subscribe(listener: () => void): () => void;
}

export interface LiveHubDeps {
  client: ImsClient;
  queryClient: QueryClient;
  transport: Transport;
  /** True at start unless told otherwise (web has no AppState). */
  active?: boolean;
  stream?: Pick<WatchOptions, "staleMs" | "sleep" | "random">;
}

interface Watched {
  refs: number;
  controller: AbortController | undefined;
  live: boolean;
  /** Set once a stream has been open, so the next open is a resume. */
  gap: boolean;
}

export function createLiveHub(deps: LiveHubDeps): LiveHub {
  const watched = new Map<number, Watched>();
  const listeners = new Set<() => void>();
  let active = deps.active ?? true;

  const notify = () => {
    for (const l of listeners) {
      l();
    }
  };

  /** No input = every read of that method, whatever its input (a partial key). */
  const invalidate = <M extends DescMethodUnary>(
    schema: M,
    input?: MessageInitShape<M["input"]>,
  ) => {
    void deps.queryClient.invalidateQueries({
      queryKey: createConnectQueryKey({
        schema,
        transport: deps.transport,
        cardinality: "finite",
        ...(input === undefined ? {} : { input }),
      }),
    });
  };

  const refetchEvent = (eventId: number) => {
    invalidate(ImsService.method.listIncidents, { eventId });
    invalidate(ImsService.method.listReports, { eventId });
    invalidate(ImsService.method.getIncident);
    invalidate(ImsService.method.getReport);
  };

  const open = (eventId: number, entry: Watched) => {
    if (entry.controller || !active) {
      return;
    }
    const controller = new AbortController();
    entry.controller = controller;
    void watchEvents(
      deps.client,
      { eventIds: [eventId], signal: controller.signal, ...deps.stream },
      {
        onOpen: (gap) => {
          entry.live = true;
          if (gap || entry.gap) {
            refetchEvent(eventId);
          }
          entry.gap = true;
          notify();
        },
        onDrop: () => {
          entry.live = false;
          notify();
        },
        onPoke: (response) => {
          const poke = response.poke;
          if (!poke) {
            return;
          }
          if (
            poke.kind === EventPokeKind.INCIDENT_CHANGED &&
            poke.incidentNumber !== undefined
          ) {
            invalidate(ImsService.method.getIncident, {
              eventId: poke.eventId,
              incidentNumber: poke.incidentNumber,
            });
            invalidate(ImsService.method.listIncidents, {
              eventId: poke.eventId,
            });
          } else if (
            poke.kind === EventPokeKind.REPORT_CHANGED &&
            poke.reportNumber !== undefined
          ) {
            invalidate(ImsService.method.getReport, {
              eventId: poke.eventId,
              reportNumber: poke.reportNumber,
            });
            invalidate(ImsService.method.listReports, {
              eventId: poke.eventId,
            });
          }
        },
      },
    ).finally(() => {
      if (entry.controller === controller) {
        entry.controller = undefined;
      }
    });
  };

  const close = (entry: Watched) => {
    entry.controller?.abort();
    entry.controller = undefined;
    if (entry.live) {
      entry.live = false;
      notify();
    }
  };

  return {
    watch(eventId) {
      let entry = watched.get(eventId);
      if (!entry) {
        entry = { refs: 0, controller: undefined, live: false, gap: false };
        watched.set(eventId, entry);
      }
      entry.refs += 1;
      open(eventId, entry);
      let released = false;
      return () => {
        if (released || !entry) {
          return;
        }
        released = true;
        entry.refs -= 1;
        if (entry.refs === 0) {
          close(entry);
          watched.delete(eventId);
        }
      };
    },
    setActive(next) {
      if (next === active) {
        return;
      }
      active = next;
      for (const [eventId, entry] of watched) {
        if (active) {
          open(eventId, entry);
        } else {
          close(entry);
        }
      }
    },
    isLive: (eventId) => watched.get(eventId)?.live ?? false,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
