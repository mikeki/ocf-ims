// SPDX-License-Identifier: Apache-2.0

import type { DescMethodUnary, MessageInitShape } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { createConnectQueryKey } from "@connectrpc/connect-query";
import type {
  IncidentView,
  ListIncidentsResponse,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { EventPokeKind } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/stream_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import type { QueryClient } from "@tanstack/react-query";
import type { ImsClient } from "@/api/client";
import { toAppError } from "@/api/errors";
import { type WatchOptions, watchEvents } from "@/api/stream";

// The live hub (plan 09v): one WatchEvent stream per event while any screen
// watches it, shared by reference count; paused when the app leaves the
// foreground and reopened — with a full refetch — when it returns. The
// screens' queries refetch through the access-gated reads, as they always
// did. The 30 s polls stay as the fallback for a stream that will not open.
//
// An INCIDENT_CHANGED poke patches the cached lists directly instead of
// refetching them (plan 09x criterion 10): `getIncident` for the number, then
// the row replaces, inserts or — on NotFound, the incident went private to
// this viewer — is removed from every cached `listIncidents` for the event.
// Selection, scroll and an open drawer never move, because the list query
// itself never refetches.

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

/** The cache matches `excludeSystemEntries: true` (`useIncidents`). */
function stripSystemEntries(view: IncidentView): IncidentView {
  if (!view.incident) {
    return view;
  }
  return {
    ...view,
    incident: {
      ...view.incident,
      journalEntries: view.incident.journalEntries.filter(
        (e) => !e.systemEntry,
      ),
    },
  };
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

  /**
   * `GetIncident` for the poke, then patch every cached `listIncidents` for
   * the event (criterion 10): replace the row by number, insert it when
   * absent, remove it on NotFound. Never refetches the list itself, so the
   * table's selection and scroll do not move.
   */
  // Pokes for one incident can overlap; only the latest fetch may write.
  const patchSeq = new Map<string, number>();
  const patchIncidentList = async (eventId: number, number: number) => {
    const key = `${eventId}:${number}`;
    const seq = (patchSeq.get(key) ?? 0) + 1;
    patchSeq.set(key, seq);
    let incident: IncidentView | undefined;
    try {
      const response = await deps.client.getIncident({
        eventId,
        incidentNumber: number,
      });
      incident = response.incident;
    } catch (err) {
      if (toAppError(err).kind !== "notFound") {
        // Anything else: fall back to the list refetch rather than stay stale.
        invalidate(ImsService.method.listIncidents, { eventId });
        return;
      }
    }
    if (patchSeq.get(key) !== seq) {
      return;
    }
    const patched = incident ? stripSystemEntries(incident) : undefined;
    deps.queryClient.setQueriesData<ListIncidentsResponse>(
      {
        queryKey: createConnectQueryKey({
          schema: ImsService.method.listIncidents,
          transport: deps.transport,
          cardinality: "finite",
          input: { eventId },
        }),
      },
      (prev) => {
        if (!prev) {
          return prev;
        }
        const at = prev.incidents.findIndex(
          (v) => v.incident?.number === number,
        );
        const incidents = [...prev.incidents];
        if (!patched) {
          incidents.splice(at, at < 0 ? 0 : 1);
        } else if (at < 0) {
          incidents.push(patched);
        } else {
          incidents[at] = patched;
        }
        return { ...prev, incidents };
      },
    );
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
            void patchIncidentList(poke.eventId, poke.incidentNumber);
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
