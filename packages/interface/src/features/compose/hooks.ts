// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  createConnectQueryKey,
  createProtobufSafeUpdater,
  useMutation,
  useQuery,
  useTransport,
} from "@connectrpc/connect-query";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { GetIncidentResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearDraft,
  type Draft,
  type DraftTarget,
  isEmptyDraft,
  loadDraft,
  saveDraft,
} from "@/features/compose/drafts";
import { MENTION_QUERY_MIN } from "@/features/compose/mentions";
import { appendUpdate, type EntryInput } from "@/features/compose/payload";

// Domain hooks for filing and appending (plan 09r § Cache): the mutations and
// what they invalidate, the mention typeahead, and the per-target draft.

const MENTION_STALE_MS = 60_000;
/** Typing pauses this long before the draft is written. */
export const DRAFT_DEBOUNCE_MS = 400;

/** ListPersonnel{query}: asks only from MENTION_QUERY_MIN characters, as the server answers. */
export function useMentionSearch(eventId: number, query: string): Person[] {
  const q = query.trim();
  const { data } = useQuery(
    ImsService.method.listPersonnel,
    { eventId, query: q },
    { enabled: q.length >= MENTION_QUERY_MIN, staleTime: MENTION_STALE_MS },
  );
  return q.length >= MENTION_QUERY_MIN ? (data?.people ?? []) : [];
}

export function useFileIncident() {
  const transport = useTransport();
  const queryClient = useQueryClient();
  return useMutation(ImsService.method.createIncident, {
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: ImsService.method.listIncidents,
          transport,
          cardinality: "finite",
        }),
      });
    },
  });
}

/**
 * Append one entry: optimistic in the incident's cache (a negative id, my
 * handle, now), then the incident and the list refetch on settle; an error
 * rolls the cache back and the screen keeps the text.
 */
export function useAppendEntry(
  eventId: number,
  number: number,
  author: string,
) {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const incidentKey = createConnectQueryKey({
    schema: ImsService.method.getIncident,
    transport,
    input: { eventId, incidentNumber: number },
    cardinality: "finite",
  });
  const mutation = useMutation(ImsService.method.updateIncident, {
    onMutate: async (req) => {
      await queryClient.cancelQueries({ queryKey: incidentKey });
      const previous =
        queryClient.getQueryData<GetIncidentResponse>(incidentKey);
      const pending = req.update?.journalEntries?.[0];
      if (pending) {
        queryClient.setQueryData(
          incidentKey,
          createProtobufSafeUpdater(ImsService.method.getIncident, (prev) => {
            if (!prev?.incident?.incident) {
              return prev;
            }
            const entry = create(JournalEntrySchema, {
              id: -Date.now(),
              created: timestampFromDate(new Date()),
              author,
              text: pending.text ?? "",
              mentions: (pending.mentionedPersonIds ?? []).map((personId) => ({
                personId,
              })),
            });
            return {
              ...prev,
              incident: {
                ...prev.incident,
                incident: {
                  ...prev.incident.incident,
                  journalEntries: [
                    ...prev.incident.incident.journalEntries,
                    entry,
                  ],
                },
              },
            };
          }),
        );
      }
      return { previous };
    },
    onError: (_error, _req, context) => {
      if (context?.previous) {
        queryClient.setQueryData(incidentKey, context.previous);
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: incidentKey }),
        queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: ImsService.method.listIncidents,
            transport,
            cardinality: "finite",
          }),
        }),
      ]);
    },
  });
  const append = useCallback(
    (entry: EntryInput) =>
      mutation.mutateAsync({
        eventId,
        incidentNumber: number,
        update: appendUpdate(entry),
      }),
    [mutation.mutateAsync, eventId, number],
  );
  return { append, isPending: mutation.isPending };
}

export function useProposeType(eventId: number) {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const mutation = useMutation(ImsService.method.proposeIncidentType, {
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: ImsService.method.listIncidentTypes,
          transport,
          cardinality: "finite",
        }),
      });
    },
  });
  return useCallback(
    async (name: string) => {
      const res = await mutation.mutateAsync({
        eventId,
        incidentType: { name },
      });
      return res.incidentTypeId;
    },
    [mutation.mutateAsync, eventId],
  );
}

export function useCreateArea(eventId: number) {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const mutation = useMutation(ImsService.method.createArea, {
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: ImsService.method.listAreas,
          transport,
          input: { eventId },
          cardinality: "finite",
        }),
      });
    },
  });
  return useCallback(
    async (name: string) => {
      const res = await mutation.mutateAsync({ eventId, area: { name } });
      return res.areaSlug;
    },
    [mutation.mutateAsync, eventId],
  );
}

export interface DraftHandle {
  /** Whether the first read from storage has finished. */
  loaded: boolean;
  /** A non-empty draft was found on load — show the note. */
  restored: boolean;
  draft: Draft;
  update(patch: Partial<Draft>): void;
  /** Write now (blur, background). */
  flush(): void;
  /** Sent: forget it. */
  clear(): void;
}

/**
 * This device's unsent text for one target. Saves on a debounce while typing,
 * flushes on unmount, restores on open with `restored` set for the note.
 */
export function useDraft(
  eventId: number,
  target: DraftTarget,
  initial: Draft = { text: "" },
): DraftHandle {
  const [draft, setDraft] = useState<Draft>(initial);
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const latest = useRef(draft);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void loadDraft(AsyncStorage, eventId, target)
      .catch(() => undefined)
      .then((stored) => {
        if (cancelled) {
          return;
        }
        if (stored && !isEmptyDraft(stored) && isEmptyDraft(latest.current)) {
          latest.current = stored;
          setDraft(stored);
          setRestored(true);
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, target]);

  const write = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    if (!dirty.current) {
      return;
    }
    dirty.current = false;
    void saveDraft(AsyncStorage, eventId, target, latest.current).catch(
      () => undefined,
    );
  }, [eventId, target]);

  const update = useCallback(
    (patch: Partial<Draft>) => {
      latest.current = { ...latest.current, ...patch };
      dirty.current = true;
      setDraft(latest.current);
      setRestored(false);
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(write, DRAFT_DEBOUNCE_MS);
    },
    [write],
  );

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    dirty.current = false;
    latest.current = { text: "" };
    setDraft({ text: "" });
    setRestored(false);
    void clearDraft(AsyncStorage, eventId, target).catch(() => undefined);
  }, [eventId, target]);

  // Unmount flushes what the debounce has not written yet.
  useEffect(() => write, [write]);

  return { loaded, restored, draft, update, flush: write, clear };
}
