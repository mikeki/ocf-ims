// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import {
  createConnectQueryKey,
  createProtobufSafeUpdater,
  useMutation,
  useTransport,
} from "@connectrpc/connect-query";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  ParticipationType,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { ListPersonnelResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/person_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { type AppError, toAppError } from "@/api/errors";
import { identityFor } from "@/prototypes/people/data";
import type { Viewer } from "@/prototypes/people/types";

// The roster's one hook (docs/plans/09aa-roster-design.md § One field, one
// request): every write is a single field on a single row — optimistic on
// the row, the error at the control, `ListPersonnel` (every mode) and
// `ListMyCrews` invalidated on settle. `rungsFor`/`mayRemove` are exported
// alongside it (not hook state — pure, so a variant can call them per row
// without a hook of their own) and read `data.ts#identityFor` for the
// viewer's admin/invite bits, exactly "### Gating and the ceiling".
//
// Finding: `RemovePersonFromEvent` (person_id, event_id — no rung) cannot
// carry Not present vs Ejected, so "Remove from event"'s two forms are both
// `SetPersonParticipation` writes, same as any other role change; this hook
// has no separate code path for the dedicated RPC (`remove` and `setRole`
// are the same write). A 3c.4 criterion should say when the client calls
// RemovePersonFromEvent at all, if ever.

const ADMIN_RUNGS: ParticipationType[] = [
  ParticipationType.WRITER,
  ParticipationType.REPORTER,
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];
const INVITER_RUNGS: ParticipationType[] = [
  ParticipationType.REPORTER,
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];
const NO_LOGIN_RUNGS: ParticipationType[] = [
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];

/** The rungs `viewer` may set on `person` — the server's ceiling, client-mirrored so the menu never offers what it would refuse. */
export function rungsFor(viewer: Viewer, person: Person): ParticipationType[] {
  const id = identityFor(viewer);
  if (!person.hasPassword) {
    return [...NO_LOGIN_RUNGS];
  }
  if (id.admin) {
    return [...ADMIN_RUNGS];
  }
  if (id.canInvite) {
    if (
      person.participationType === ParticipationType.WRITER ||
      person.participationType === ParticipationType.CREW_LEADER
    ) {
      return [];
    }
    return [...INVITER_RUNGS];
  }
  return [];
}

/** Same ceiling as `rungsFor`: "Remove from event" is offered exactly where a no-access rung could be set. */
export function mayRemove(viewer: Viewer, person: Person): boolean {
  return rungsFor(viewer, person).length > 0;
}

export interface CreatePersonForm {
  handle?: string;
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  useDefaultPassword?: boolean;
  wristband?: string;
  participationType?: ParticipationType;
}

interface RowStatus {
  pending: boolean;
  error?: AppError;
}

export interface Roster {
  setRole(personId: number, rung: ParticipationType): Promise<void>;
  remove(personId: number, rung: ParticipationType): Promise<void>;
  enrol(personId: number, rung?: ParticipationType): Promise<void>;
  create(form: CreatePersonForm): Promise<Person | undefined>;
  addToCrew(slug: string, personId: number): Promise<void>;
  removeFromCrew(slug: string, personId: number): Promise<void>;
  errorFor(personId: number): AppError | undefined;
  pendingFor(personId: number): boolean;
}

export function useRoster(eventId: number): Roster {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Record<number, RowStatus>>({});

  const listKey = createConnectQueryKey({
    schema: ImsService.method.listPersonnel,
    transport,
    input: { eventId, all: true },
    cardinality: "finite",
  });
  const crewsKey = createConnectQueryKey({
    schema: ImsService.method.listMyCrews,
    transport,
    input: { eventId },
    cardinality: "finite",
  });

  const mark = useCallback((personId: number, status: RowStatus) => {
    setRows((all) => ({ ...all, [personId]: status }));
  }, []);

  const patchPerson = useCallback(
    (personId: number, apply: (p: Person) => Person) => {
      queryClient.setQueryData(
        listKey,
        createProtobufSafeUpdater(ImsService.method.listPersonnel, (prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            people: prev.people.map((p) =>
              p.personId === personId ? apply(p) : p,
            ),
          };
        }),
      );
    },
    [queryClient, listKey],
  );

  const settle = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: listKey }),
        queryClient.invalidateQueries({ queryKey: crewsKey }),
      ]),
    [queryClient, listKey, crewsKey],
  );

  const setParticipation = useMutation(
    ImsService.method.setPersonParticipation,
  );
  const createPersonMutation = useMutation(ImsService.method.createPerson);
  const setMembership = useMutation(ImsService.method.setMyCrewMembership);

  const writeRole = useCallback(
    async (personId: number, rung: ParticipationType) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<ListPersonnelResponse>(listKey);
      const before = previous?.people.find((p) => p.personId === personId);
      mark(personId, { pending: true });
      patchPerson(personId, (p) =>
        create(PersonSchema, { ...p, participationType: rung }),
      );
      try {
        await setParticipation.mutateAsync({
          personId,
          eventId,
          wristband: before?.wristband ?? "",
          participationType: rung,
        });
        mark(personId, { pending: false });
      } catch (e) {
        if (before) {
          patchPerson(personId, () => before);
        }
        mark(personId, { pending: false, error: toAppError(e) });
        throw e;
      } finally {
        await settle();
      }
    },
    [
      queryClient,
      listKey,
      mark,
      patchPerson,
      setParticipation.mutateAsync,
      eventId,
      settle,
    ],
  );

  const remove = useCallback(
    (personId: number, rung: ParticipationType) => writeRole(personId, rung),
    [writeRole],
  );

  const enrol = useCallback(
    (personId: number, rung: ParticipationType = ParticipationType.REPORTER) =>
      writeRole(personId, rung),
    [writeRole],
  );

  const createPerson = useCallback(
    async (form: CreatePersonForm) => {
      try {
        const res = await createPersonMutation.mutateAsync({
          handle: form.handle ?? "",
          name: form.name ?? "",
          email: form.email ?? "",
          phone: form.phone ?? "",
          password: form.password ?? "",
          useDefaultPassword: form.useDefaultPassword ?? false,
          eventId,
          wristband: form.wristband ?? "",
          participationType:
            form.participationType ?? ParticipationType.UNSPECIFIED,
        });
        return res.person;
      } finally {
        await settle();
      }
    },
    [createPersonMutation.mutateAsync, eventId, settle],
  );

  const addToCrew = useCallback(
    async (slug: string, personId: number) => {
      mark(personId, { pending: true });
      try {
        await setMembership.mutateAsync({
          eventId,
          crewSlug: slug,
          personId,
          remove: false,
          isLeader: false,
        });
        mark(personId, { pending: false });
      } catch (e) {
        mark(personId, { pending: false, error: toAppError(e) });
        throw e;
      } finally {
        await settle();
      }
    },
    [setMembership.mutateAsync, eventId, mark, settle],
  );

  const removeFromCrew = useCallback(
    async (slug: string, personId: number) => {
      mark(personId, { pending: true });
      try {
        await setMembership.mutateAsync({
          eventId,
          crewSlug: slug,
          personId,
          remove: true,
          isLeader: false,
        });
        mark(personId, { pending: false });
      } catch (e) {
        mark(personId, { pending: false, error: toAppError(e) });
        throw e;
      } finally {
        await settle();
      }
    },
    [setMembership.mutateAsync, eventId, mark, settle],
  );

  return {
    setRole: writeRole,
    remove,
    enrol,
    create: createPerson,
    addToCrew,
    removeFromCrew,
    errorFor: (personId: number) => rows[personId]?.error,
    pendingFor: (personId: number) => rows[personId]?.pending === true,
  };
}
