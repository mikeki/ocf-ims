// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import {
  createConnectQueryKey,
  createProtobufSafeUpdater,
  useMutation,
  useTransport,
} from "@connectrpc/connect-query";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { Report } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import { ReportSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import type { GetReportResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { type AppError, toAppError } from "@/api/errors";

// The report pane's one hook (docs/plans/09z-reports-design.md § One field,
// one request), mirroring src/features/incidents/useEditIncident.ts:
// `setSummary`, `setIncident` (a number, or 0 to detach), `strike` — each a
// plain Report (or entry) carrying only that field; optimistic per field,
// the error at the control; on settle, GetReport and ListReports invalidate
// always, and — when the link's target number actually changed — the OLD
// and NEW incident's GetIncident and ListIncidents too, so a Companion-style
// column reading the incident notices either side of the move.

export type ReportFieldName = "summary" | "incident" | "strike";

export interface FieldStatus {
  /** A save in flight for this field. */
  pending: boolean;
  /** The last save's error, until the next attempt. */
  error?: AppError;
}

export interface EditReport {
  status: (field: ReportFieldName) => FieldStatus;
  setSummary: (summary: string) => Promise<void>;
  /** 0 detaches. */
  setIncident: (incidentNumber: number) => Promise<void>;
  strike: (entryId: number, stricken: boolean) => Promise<void>;
}

type Apply = (report: Report) => Report;

export function useEditReport(eventId: number, number: number): EditReport {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<
    Partial<Record<ReportFieldName, FieldStatus>>
  >({});

  const reportKey = createConnectQueryKey({
    schema: ImsService.method.getReport,
    transport,
    input: { eventId, reportNumber: number },
    cardinality: "finite",
  });
  const listKey = createConnectQueryKey({
    schema: ImsService.method.listReports,
    transport,
    cardinality: "finite",
  });

  const mark = useCallback((field: ReportFieldName, status: FieldStatus) => {
    setStatuses((all) => ({ ...all, [field]: status }));
  }, []);

  const patchCache = useCallback(
    (apply: Apply) => {
      queryClient.setQueryData(
        reportKey,
        createProtobufSafeUpdater(ImsService.method.getReport, (prev) => {
          if (!prev?.report?.report) {
            return prev;
          }
          return {
            ...prev,
            report: { ...prev.report, report: apply(prev.report.report) },
          };
        }),
      );
    },
    [queryClient, reportKey],
  );

  /**
   * The optimistic dance every write shares: cancel in-flight reads, snapshot
   * the field's server value, apply the optimistic value, and on error put
   * exactly that field back (leaving whatever a poke changed since).
   * `invalidateIncidents` names the incident numbers (old, new — either may
   * be 0/absent) a settled link write also touches.
   */
  const run = useCallback(
    async <T>(
      field: ReportFieldName,
      read: (report: Report) => T,
      write: (report: Report, value: T) => Report,
      value: T,
      send: () => Promise<unknown>,
      /** Named against the field's own before/after, not the settled cache — a write's own optimistic patch must not shadow its "before". */
      invalidateIncidents?: (
        before: T | undefined,
        value: T,
      ) => (number | undefined)[],
    ) => {
      await queryClient.cancelQueries({ queryKey: reportKey });
      const previous = queryClient.getQueryData<GetReportResponse>(reportKey);
      const before = previous?.report?.report
        ? read(previous.report.report)
        : undefined;
      mark(field, { pending: true });
      patchCache((report) => write(report, value));
      try {
        await send();
        mark(field, { pending: false });
      } catch (e) {
        if (before !== undefined) {
          patchCache((report) => write(report, before));
        }
        mark(field, { pending: false, error: toAppError(e) });
        throw e;
      } finally {
        const incidentInvalidations = (
          invalidateIncidents?.(before, value) ?? []
        )
          .filter((n): n is number => n !== undefined && n > 0)
          .flatMap((incidentNumber) => [
            queryClient.invalidateQueries({
              queryKey: createConnectQueryKey({
                schema: ImsService.method.getIncident,
                transport,
                input: { eventId, incidentNumber },
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
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: reportKey }),
          queryClient.invalidateQueries({ queryKey: listKey }),
          ...incidentInvalidations,
        ]);
      }
    },
    [queryClient, reportKey, listKey, mark, patchCache, transport, eventId],
  );

  const update = useMutation(ImsService.method.updateReport);
  const strikeMutation = useMutation(
    ImsService.method.updateReportJournalEntry,
  );

  const status = useCallback(
    (field: ReportFieldName): FieldStatus =>
      statuses[field] ?? { pending: false },
    [statuses],
  );

  const setSummary = useCallback(
    (summary: string) =>
      run(
        "summary",
        (r) => r.summary ?? "",
        (r, v) => create(ReportSchema, { ...r, summary: v || undefined }),
        summary,
        () =>
          update.mutateAsync({
            eventId,
            reportNumber: number,
            report: { summary },
          }),
      ),
    [run, update.mutateAsync, eventId, number],
  );

  const setIncident = useCallback(
    (incidentNumber: number) =>
      run(
        "incident",
        (r) => r.incident ?? 0,
        (r, v) =>
          create(ReportSchema, { ...r, incident: v > 0 ? v : undefined }),
        incidentNumber,
        () =>
          update.mutateAsync({
            eventId,
            reportNumber: number,
            report: { incident: incidentNumber },
          }),
        (before, after) => [before, after],
      ),
    [run, update.mutateAsync, eventId, number],
  );

  const strike = useCallback(
    (entryId: number, stricken: boolean) =>
      run(
        "strike",
        (r) =>
          r.journalEntries.find((e) => e.id === entryId)?.stricken === true,
        (r, v) =>
          create(ReportSchema, {
            ...r,
            journalEntries: r.journalEntries.map((e) =>
              e.id === entryId
                ? create(JournalEntrySchema, { ...e, stricken: v })
                : e,
            ),
          }),
        stricken,
        () =>
          strikeMutation.mutateAsync({
            eventId,
            reportNumber: number,
            journalEntryId: entryId,
            entry: { id: entryId, stricken },
          }),
      ),
    [run, strikeMutation.mutateAsync, eventId, number],
  );

  return { status, setSummary, setIncident, strike };
}
