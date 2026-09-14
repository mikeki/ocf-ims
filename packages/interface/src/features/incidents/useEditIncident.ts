// SPDX-License-Identifier: Apache-2.0

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  createConnectQueryKey,
  createProtobufSafeUpdater,
  useMutation,
  useTransport,
} from "@connectrpc/connect-query";
import { IncidentRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/incident_ref_pb";
import type {
  Incident,
  IncidentPerson,
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  IncidentLocationSchema,
  IncidentPersonSchema,
  IncidentSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type {
  GetIncidentResponse,
  IncidentUpdateSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { type AppError, toAppError } from "@/api/errors";

// The editor's one hook (plan 09y § One field, one request): per-field
// setters over a single UpdateIncident mutation. Each setter sends ONLY its
// own field (lists send their whole current list), writes it into the cached
// GetIncident optimistically, restores that field alone on an error and
// surfaces the error at the control, and invalidates the incident and the
// list on settle. People go through the attach / detach RPCs; a strike
// through UpdateIncidentJournalEntry, optimistic on the entry.
//
// Shape-independent: the three variants share it; only what wraps the
// setters differs.

export type FieldName =
  | "state"
  | "priority"
  | "private"
  | "outcome"
  | "started"
  | "summary"
  | "area"
  | "description"
  | "booth"
  | "types"
  | "links"
  | "reports"
  | "people"
  | "strike";

export interface FieldStatus {
  /** A save in flight for this field. */
  pending: boolean;
  /** The last save's error, until the next attempt. */
  error?: AppError;
}

export interface LinkInput {
  eventId: number;
  incidentNumber: number;
}

export interface EditIncident {
  status: (field: FieldName) => FieldStatus;
  setState: (state: IncidentState) => Promise<void>;
  setPriority: (priority: IncidentPriority) => Promise<void>;
  setPrivate: (isPrivate: boolean) => Promise<void>;
  /** 0 clears. */
  setOutcome: (outcomeId: number) => Promise<void>;
  setStarted: (started: Timestamp) => Promise<void>;
  setSummary: (summary: string) => Promise<void>;
  /** undefined clears. */
  setArea: (slug: string | undefined) => Promise<void>;
  setDescription: (description: string) => Promise<void>;
  setBooth: (booth: string) => Promise<void>;
  setTypes: (ids: number[]) => Promise<void>;
  setLinks: (links: LinkInput[]) => Promise<void>;
  setReports: (numbers: number[]) => Promise<void>;
  attachPerson: (
    person: Person,
    involvement: string | undefined,
    grantAccess: boolean,
  ) => Promise<void>;
  /** Re-attach with new values: the server updates the row. */
  updatePerson: (
    personId: number,
    involvement: string | undefined,
    grantAccess: boolean,
  ) => Promise<void>;
  detachPerson: (personId: number) => Promise<void>;
  setStricken: (entryId: number, stricken: boolean) => Promise<void>;
}

type Apply = (incident: Incident) => Incident;

export function useEditIncident(eventId: number, number: number): EditIncident {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const [statuses, setStatuses] = useState<
    Partial<Record<FieldName, FieldStatus>>
  >({});

  const incidentKey = createConnectQueryKey({
    schema: ImsService.method.getIncident,
    transport,
    input: { eventId, incidentNumber: number },
    cardinality: "finite",
  });
  const listKey = createConnectQueryKey({
    schema: ImsService.method.listIncidents,
    transport,
    cardinality: "finite",
  });

  const mark = useCallback((field: FieldName, status: FieldStatus) => {
    setStatuses((all) => ({ ...all, [field]: status }));
  }, []);

  const patchCache = useCallback(
    (apply: Apply) => {
      queryClient.setQueryData(
        incidentKey,
        createProtobufSafeUpdater(ImsService.method.getIncident, (prev) => {
          if (!prev?.incident?.incident) {
            return prev;
          }
          return {
            ...prev,
            incident: {
              ...prev.incident,
              incident: apply(prev.incident.incident),
            },
          };
        }),
      );
    },
    [queryClient, incidentKey],
  );

  /**
   * The optimistic dance every write shares: cancel in-flight reads, snapshot
   * the field's server value, apply the optimistic value, and on error put
   * exactly that field back (leaving whatever a poke changed since).
   */
  const run = useCallback(
    async <T>(
      field: FieldName,
      read: (incident: Incident) => T,
      write: (incident: Incident, value: T) => Incident,
      value: T,
      send: () => Promise<unknown>,
    ) => {
      await queryClient.cancelQueries({ queryKey: incidentKey });
      const previous =
        queryClient.getQueryData<GetIncidentResponse>(incidentKey);
      const before = previous?.incident?.incident
        ? read(previous.incident.incident)
        : undefined;
      mark(field, { pending: true });
      patchCache((incident) => write(incident, value));
      try {
        await send();
        mark(field, { pending: false });
      } catch (e) {
        if (before !== undefined) {
          patchCache((incident) => write(incident, before));
        }
        mark(field, { pending: false, error: toAppError(e) });
        throw e;
      } finally {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: incidentKey }),
          queryClient.invalidateQueries({ queryKey: listKey }),
        ]);
      }
    },
    [queryClient, incidentKey, listKey, mark, patchCache],
  );

  const update = useMutation(ImsService.method.updateIncident);
  const attach = useMutation(ImsService.method.attachPersonToIncident);
  const detach = useMutation(ImsService.method.detachPersonFromIncident);
  const strike = useMutation(ImsService.method.updateIncidentJournalEntry);

  const sendUpdate = useCallback(
    (fields: MessageInitShape<typeof IncidentUpdateSchema>) =>
      update.mutateAsync({
        eventId,
        incidentNumber: number,
        update: { ...fields, journalEntries: [] },
      }),
    [update.mutateAsync, eventId, number],
  );

  const status = useCallback(
    (field: FieldName): FieldStatus => statuses[field] ?? { pending: false },
    [statuses],
  );

  const setState = useCallback(
    (state: IncidentState) =>
      run(
        "state",
        (i) => ({ state: i.state, closed: i.closed }),
        (i, v) =>
          create(IncidentSchema, { ...i, state: v.state, closed: v.closed }),
        { state, closed: undefined },
        () => sendUpdate({ state }),
      ),
    [run, sendUpdate],
  );

  const setPriority = useCallback(
    (priority: IncidentPriority) =>
      run(
        "priority",
        (i) => i.priority,
        (i, v) => create(IncidentSchema, { ...i, priority: v }),
        priority,
        () => sendUpdate({ priority }),
      ),
    [run, sendUpdate],
  );

  const setPrivate = useCallback(
    (isPrivate: boolean) =>
      run(
        "private",
        (i) => i.private === true,
        (i, v) => create(IncidentSchema, { ...i, private: v }),
        isPrivate,
        () => sendUpdate({ private: isPrivate }),
      ),
    [run, sendUpdate],
  );

  const setOutcome = useCallback(
    (outcomeId: number) =>
      run(
        "outcome",
        (i) => i.outcomeId ?? 0,
        (i, v) =>
          create(IncidentSchema, { ...i, outcomeId: v === 0 ? undefined : v }),
        outcomeId,
        () => sendUpdate({ outcomeId }),
      ),
    [run, sendUpdate],
  );

  const setStarted = useCallback(
    (started: Timestamp) =>
      run(
        "started",
        (i) => i.started,
        (i, v) => create(IncidentSchema, { ...i, started: v }),
        started,
        () => sendUpdate({ started }),
      ),
    [run, sendUpdate],
  );

  const setSummary = useCallback(
    (summary: string) =>
      run(
        "summary",
        (i) => i.summary ?? "",
        (i, v) => create(IncidentSchema, { ...i, summary: v || undefined }),
        summary,
        () => sendUpdate({ summary }),
      ),
    [run, sendUpdate],
  );

  const setLocationPiece = useCallback(
    (
      field: "area" | "description" | "booth",
      key: "areaSlug" | "description" | "booth",
      value: string,
    ) =>
      run(
        field,
        (i) => i.location?.[key] ?? "",
        (i, v) =>
          create(IncidentSchema, {
            ...i,
            location: create(IncidentLocationSchema, {
              ...(i.location ?? {}),
              [key]: v || undefined,
            }),
          }),
        value,
        () => sendUpdate({ location: { [key]: value } }),
      ),
    [run, sendUpdate],
  );

  const setArea = useCallback(
    (slug: string | undefined) =>
      setLocationPiece("area", "areaSlug", slug ?? ""),
    [setLocationPiece],
  );
  const setDescription = useCallback(
    (description: string) =>
      setLocationPiece("description", "description", description),
    [setLocationPiece],
  );
  const setBooth = useCallback(
    (booth: string) => setLocationPiece("booth", "booth", booth),
    [setLocationPiece],
  );

  const setTypes = useCallback(
    (ids: number[]) =>
      run(
        "types",
        (i) => i.incidentTypeIds,
        (i, v) => create(IncidentSchema, { ...i, incidentTypeIds: v }),
        ids,
        () => sendUpdate({ incidentTypeIds: { values: ids } }),
      ),
    [run, sendUpdate],
  );

  const setLinks = useCallback(
    (links: LinkInput[]) =>
      run(
        "links",
        (i) => i.linkedIncidents,
        (i, v) => create(IncidentSchema, { ...i, linkedIncidents: v }),
        links.map((l) =>
          create(IncidentRefSchema, {
            eventId: l.eventId,
            incidentNumber: l.incidentNumber,
          }),
        ),
        () => sendUpdate({ linkedIncidents: { refs: links } }),
      ),
    [run, sendUpdate],
  );

  const setReports = useCallback(
    (numbers: number[]) =>
      run(
        "reports",
        (i) => i.reports,
        (i, v) => create(IncidentSchema, { ...i, reports: v }),
        numbers,
        () => sendUpdate({ reports: { values: numbers } }),
      ),
    [run, sendUpdate],
  );

  // People: the value is the whole list; `null` means "apply this row's
  // change to whatever the cache holds now", so a restore puts the list back.
  const peopleRun = useCallback(
    (
      transform: (people: IncidentPerson[]) => IncidentPerson[],
      send: () => Promise<unknown>,
    ) =>
      run<IncidentPerson[] | null>(
        "people",
        (i) => i.people,
        (i, v) =>
          create(IncidentSchema, {
            ...i,
            people: v === null ? transform(i.people) : v,
          }),
        null,
        send,
      ),
    [run],
  );

  const attachPerson = useCallback(
    (person: Person, involvement: string | undefined, grantAccess: boolean) =>
      peopleRun(
        (people) => [
          ...people.filter((p) => p.person?.personId !== person.personId),
          create(IncidentPersonSchema, {
            person: {
              personId: person.personId,
              handle: person.handle,
              name: person.name,
            },
            involvement,
            grantedAccess: grantAccess,
            hasEventAccess: true,
          }),
        ],
        () =>
          attach.mutateAsync({
            eventId,
            incidentNumber: number,
            personId: person.personId,
            involvement,
            grantedAccess: grantAccess,
          }),
      ),
    [peopleRun, attach.mutateAsync, eventId, number],
  );

  const updatePerson = useCallback(
    (personId: number, involvement: string | undefined, grantAccess: boolean) =>
      peopleRun(
        (people) =>
          people.map((p) =>
            p.person?.personId === personId
              ? create(IncidentPersonSchema, {
                  ...p,
                  involvement,
                  grantedAccess: grantAccess,
                })
              : p,
          ),
        () =>
          attach.mutateAsync({
            eventId,
            incidentNumber: number,
            personId,
            involvement,
            grantedAccess: grantAccess,
          }),
      ),
    [peopleRun, attach.mutateAsync, eventId, number],
  );

  const detachPerson = useCallback(
    (personId: number) =>
      peopleRun(
        (people) => people.filter((p) => p.person?.personId !== personId),
        () => detach.mutateAsync({ eventId, incidentNumber: number, personId }),
      ),
    [peopleRun, detach.mutateAsync, eventId, number],
  );

  const setStricken = useCallback(
    (entryId: number, stricken: boolean) =>
      run(
        "strike",
        (i) =>
          i.journalEntries.find((e) => e.id === entryId)?.stricken === true,
        (i, v) =>
          create(IncidentSchema, {
            ...i,
            journalEntries: i.journalEntries.map((e) =>
              e.id === entryId
                ? create(JournalEntrySchema, { ...e, stricken: v })
                : e,
            ),
          }),
        stricken,
        () =>
          strike.mutateAsync({
            eventId,
            incidentNumber: number,
            journalEntryId: entryId,
            entry: { id: entryId, stricken },
          }),
      ),
    [run, strike.mutateAsync, eventId, number],
  );

  return {
    status,
    setState,
    setPriority,
    setPrivate,
    setOutcome,
    setStarted,
    setSummary,
    setArea,
    setDescription,
    setBooth,
    setTypes,
    setLinks,
    setReports,
    attachPerson,
    updatePerson,
    detachPerson,
    setStricken,
  };
}
