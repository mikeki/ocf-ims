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
import type { GetReportResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
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
import {
  appendUpdate,
  type EntryInput,
  type ReportEntryInput,
  reportAppend,
  reportLink,
} from "@/features/compose/payload";
import { useSession } from "@/session/provider";

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

// --- Reports (plan 09t, slice 3b.3b) ---

/** A pick for "on behalf of": the person and the words the footer shows. */
export interface OnBehalfOf {
  personId: number;
  label: string;
}

/**
 * The sticky "on behalf of" choice, per event, for the session (09i): a
 * module-level map, so it survives screens and dies with the app.
 */
const onBehalfOfByEvent = new Map<number, OnBehalfOf>();

export function useOnBehalfOf(eventId: number) {
  const [pick, setPickState] = useState<OnBehalfOf | undefined>(
    onBehalfOfByEvent.get(eventId),
  );
  const setPick = useCallback(
    (next: OnBehalfOf | undefined) => {
      if (next) {
        onBehalfOfByEvent.set(eventId, next);
      } else {
        onBehalfOfByEvent.delete(eventId);
      }
      setPickState(next);
    },
    [eventId],
  );
  return { pick, setPick };
}

/** Test seam: forget every event's pick. */
export function resetOnBehalfOf(): void {
  onBehalfOfByEvent.clear();
}

/** How many reports in the event the caller filed — the first-report instructions open when it is 0. */
export function useOwnReportCount(eventId: number): number | undefined {
  const { state } = useSession();
  const me = state.status === "signedIn" ? state.auth.personId : 0;
  const { data } = useQuery(
    ImsService.method.listReports,
    { eventId, excludeSystemEntries: true },
    { retry: false },
  );
  if (!data) {
    return undefined;
  }
  return data.reports.filter((v) => v.report?.createdBy?.personId === me)
    .length;
}

/** File a report; the list refetches, and the incident it linked to, if any. */
export function useCreateReport(eventId: number) {
  const transport = useTransport();
  const queryClient = useQueryClient();
  return useMutation(ImsService.method.createReport, {
    onSuccess: async (_res, req) => {
      const jobs = [
        queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: ImsService.method.listReports,
            transport,
            cardinality: "finite",
          }),
        }),
      ];
      const incident = req.report?.incident;
      if (incident) {
        jobs.push(
          queryClient.invalidateQueries({
            queryKey: createConnectQueryKey({
              schema: ImsService.method.getIncident,
              transport,
              input: { eventId, incidentNumber: incident },
              cardinality: "finite",
            }),
          }),
          queryClient.invalidateQueries({
            queryKey: createConnectQueryKey({
              schema: ImsService.method.listIncidents,
              transport,
              cardinality: "finite",
            }),
          }),
        );
      }
      await Promise.all(jobs);
    },
  });
}

/**
 * Append one entry to a report: optimistic in the report's cache, the report
 * and the list refetch on settle; an error rolls back and the screen keeps the text.
 */
export function useAppendReportEntry(
  eventId: number,
  number: number,
  author: string,
) {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const reportKey = createConnectQueryKey({
    schema: ImsService.method.getReport,
    transport,
    input: { eventId, reportNumber: number },
    cardinality: "finite",
  });
  const mutation = useMutation(ImsService.method.updateReport, {
    onMutate: async (req) => {
      await queryClient.cancelQueries({ queryKey: reportKey });
      const previous = queryClient.getQueryData<GetReportResponse>(reportKey);
      const pending = req.report?.journalEntries?.[0];
      if (pending) {
        queryClient.setQueryData(
          reportKey,
          createProtobufSafeUpdater(ImsService.method.getReport, (prev) => {
            if (!prev?.report?.report) {
              return prev;
            }
            const entry = create(JournalEntrySchema, {
              id: -Date.now(),
              created: timestampFromDate(new Date()),
              author,
              text: pending.text ?? "",
              mentions: pending.mentions ?? [],
              onBehalfOf: pending.onBehalfOf,
            });
            return {
              ...prev,
              report: {
                ...prev.report,
                report: {
                  ...prev.report.report,
                  journalEntries: [...prev.report.report.journalEntries, entry],
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
        queryClient.setQueryData(reportKey, context.previous);
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reportKey }),
        queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: ImsService.method.listReports,
            transport,
            cardinality: "finite",
          }),
        }),
      ]);
    },
  });
  const append = useCallback(
    (entry: ReportEntryInput) =>
      mutation.mutateAsync({
        eventId,
        reportNumber: number,
        report: reportAppend(entry),
      }),
    [mutation.mutateAsync, eventId, number],
  );
  return { append, isPending: mutation.isPending };
}

/** Link a report to an incident; both records refetch. */
export function useLinkReport(eventId: number, number: number) {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const mutation = useMutation(ImsService.method.updateReport, {
    onSuccess: async (_res, req) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: ImsService.method.getReport,
            transport,
            input: { eventId, reportNumber: number },
            cardinality: "finite",
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: ImsService.method.listReports,
            transport,
            cardinality: "finite",
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: ImsService.method.getIncident,
            transport,
            input: { eventId, incidentNumber: req.report?.incident ?? 0 },
            cardinality: "finite",
          }),
        }),
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
  const link = useCallback(
    (incident: number) =>
      mutation.mutateAsync({
        eventId,
        reportNumber: number,
        report: reportLink(incident),
      }),
    [mutation.mutateAsync, eventId, number],
  );
  return { link, isPending: mutation.isPending };
}

/** Ask a person for their report on an incident; the incident refetches. */
export function useRequestReport(eventId: number, number: number) {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const mutation = useMutation(ImsService.method.requestReport, {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: ImsService.method.getIncident,
            transport,
            input: { eventId, incidentNumber: number },
            cardinality: "finite",
          }),
        }),
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
  const request = useCallback(
    (personId: number) =>
      mutation.mutateAsync({ eventId, incidentNumber: number, personId }),
    [mutation.mutateAsync, eventId, number],
  );
  return { request, isPending: mutation.isPending };
}

/** Whether the report-writing instructions are open on this device for the event. */
const HELP_KEY = "ocf-ims/report-help";

export function useReportHelp(
  eventId: number,
  defaultOpen: boolean | undefined,
) {
  const [stored, setStored] = useState<boolean | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(`${HELP_KEY}/${eventId}`)
      .catch(() => null)
      .then((raw) => {
        if (cancelled) {
          return;
        }
        // A toggle that landed before the read finished wins.
        setStored((current) =>
          current !== undefined
            ? current
            : raw === null
              ? undefined
              : raw === "1",
        );
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const open = stored ?? defaultOpen ?? false;
  const setOpen = useCallback(
    (next: boolean) => {
      setStored(next);
      void AsyncStorage.setItem(
        `${HELP_KEY}/${eventId}`,
        next ? "1" : "0",
      ).catch(() => undefined);
    },
    [eventId],
  );
  return { open, setOpen, loaded };
}
