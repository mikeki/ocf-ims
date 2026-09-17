// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import type { Crew } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/crew_pb";
import {
  CrewMemberSchema,
  CrewSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/crew_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  ParticipationType,
  PersonCrewSchema,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  type AccessForEvent,
  AccessForEventSchema,
  GetAuthStatusResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import {
  ListMyCrewsResponseSchema,
  SetMyCrewMembershipResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/crew_pb";
import {
  CreatePersonResponseSchema,
  ListPersonnelResponseSchema,
  RemovePersonFromEventResponseSchema,
  SetPersonParticipationResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/person_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import type { FakeIms } from "@/test/fakeIms";

// Wraps createFakeIms() for the 3c.4 round (docs/plans/09aa-roster-design.md
// § The prototype round): the stock fake (src/test/fakeIms.ts) implements
// only ListPersonnel's `query` mode — no `all`/`person_ids`/`show_all`, no
// CreatePerson/SetPersonParticipation/RemovePersonFromEvent/ListMyCrews/
// SetMyCrewMembership at all, and GetAuthStatus's AccessForEvent has no way
// to carry `invite_reporters` (FakeUser has no such bit). Every write here
// answers after 300ms; `forceNextRoleChangeFailure` is the band's "Fail the
// next role change" action.
//
// `router.rpc(method, impl)` replaces a single method's handler; a later
// registration for the same path wins over `fake.routes()`'s own
// `router.service()` call (see reports/fake.ts's header note).

const WRITE_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bearerOf(ctx: HandlerContext): string | undefined {
  const header = ctx.requestHeader.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

/** Mirrors the server's mayAssignParticipation (53b): the anti-escalation ceiling. */
function mayAssign(admin: boolean, rung: ParticipationType): boolean {
  if (admin) {
    return true;
  }
  return (
    rung !== ParticipationType.WRITER && rung !== ParticipationType.CREW_LEADER
  );
}

/** The wire's own field gating (§ What is already true on the wire): email/phone admin-or-own-row, is_admin admin-only, the event-scoped columns only with event_id. */
function shape(
  person: Person,
  opts: { viewerId: number; admin: boolean; eventScoped: boolean },
): Person {
  const own = person.personId === opts.viewerId;
  return create(PersonSchema, {
    ...person,
    email: opts.admin || own ? person.email : undefined,
    phone: opts.admin || own ? person.phone : undefined,
    isAdmin: opts.admin ? person.isAdmin : false,
    wristband: opts.eventScoped ? person.wristband : undefined,
    participationType: opts.eventScoped
      ? person.participationType
      : ParticipationType.UNSPECIFIED,
    crews: opts.eventScoped ? person.crews : [],
  });
}

export interface PeopleFake extends FakeIms {
  /** AccessForEvent.invite_reporters for fake.user (53a) — see header note. */
  canInvite: boolean;
  /** The full crew roster; ListMyCrews filters it live by fake.user.personId leading. */
  crews: Crew[];
  /** Forces exactly the next SetPersonParticipation to answer PermissionDenied. */
  forceNextRoleChangeFailure: boolean;
}

export function wrapPeopleFake(
  fake: FakeIms,
  opts: { canInvite: boolean },
): PeopleFake {
  const extended = fake as PeopleFake;
  extended.canInvite = opts.canInvite;
  extended.crews = [];
  extended.forceNextRoleChangeFailure = false;

  const baseRoutes = fake.routes;
  fake.routes = (router: ConnectRouter) => {
    baseRoutes(router);

    router.rpc(ImsService.method.getAuthStatus, (req, ctx) => {
      fake.calls.push({
        method: "GetAuthStatus",
        bearer: bearerOf(ctx) ?? null,
      });
      if (!fake.honours(bearerOf(ctx))) {
        return create(GetAuthStatusResponseSchema, { authenticated: false });
      }
      const eventAccess: Record<number, AccessForEvent> = {};
      if (req.eventId !== undefined) {
        eventAccess[req.eventId] = create(AccessForEventSchema, {
          eventId: req.eventId,
          readIncidents: true,
          writeIncidents: fake.user.admin || fake.user.writeIncidents,
          writeReports:
            fake.user.admin ||
            fake.user.writeIncidents ||
            fake.user.writeReports,
          readAreas: fake.user.readAreas,
          attachFiles:
            fake.user.admin ||
            fake.user.writeIncidents ||
            fake.user.attachFiles,
          inviteReporters: fake.user.admin || extended.canInvite,
        });
      }
      return create(GetAuthStatusResponseSchema, {
        authenticated: true,
        user: fake.user.handle,
        personId: fake.user.personId,
        admin: fake.user.admin,
        canManagePersonnel: fake.user.admin,
        eventAccess,
        usingDefaultPassword: fake.user.usingDefaultPassword,
      });
    });

    router.rpc(ImsService.method.listPersonnel, (req, ctx) => {
      fake.calls.push({
        method: "ListPersonnel",
        bearer: bearerOf(ctx) ?? null,
      });
      if (!fake.honours(bearerOf(ctx))) {
        throw new ConnectError("not signed in", Code.Unauthenticated);
      }
      const admin = fake.user.admin;
      const eventScoped = req.eventId !== undefined;
      const opts = { viewerId: fake.user.personId, admin, eventScoped };

      // Precedence, highest first (ListPersonnelRequest's own doc comment):
      // query, then person_ids, then all, then the bare login directory.
      if (req.query !== undefined) {
        const q = req.query.trim().toLowerCase();
        if (q.length < 2) {
          return create(ListPersonnelResponseSchema, { people: [] });
        }
        return create(ListPersonnelResponseSchema, {
          people: fake.people
            .filter(
              (p) =>
                (p.handle ?? "").toLowerCase().includes(q) ||
                (p.name ?? "").toLowerCase().includes(q),
            )
            .map((p) => shape(p, opts)),
        });
      }

      if (req.personIds.length > 0) {
        return create(ListPersonnelResponseSchema, {
          people: fake.people
            .filter((p) => req.personIds.includes(p.personId))
            .map((p) => shape(p, opts)),
        });
      }

      if (req.all) {
        // The event roster (event_id set, show_all false) opens to an
        // inviter; the global listing and show_all stay admin-only.
        const isEventRoster = eventScoped && !req.showAll;
        if (!admin && !(isEventRoster && extended.canInvite)) {
          throw new ConnectError("not allowed", Code.PermissionDenied);
        }
        return create(ListPersonnelResponseSchema, {
          people: fake.people.map((p) => shape(p, opts)),
        });
      }

      // None set: the login directory — identity + picture only.
      return create(ListPersonnelResponseSchema, {
        people: fake.people.map((p) =>
          create(PersonSchema, {
            personId: p.personId,
            handle: p.handle,
            name: p.name,
            hasPassword: p.hasPassword,
            profilePictureUrl: p.profilePictureUrl,
          }),
        ),
      });
    });

    router.rpc(ImsService.method.setPersonParticipation, async (req, ctx) => {
      await delay(WRITE_DELAY_MS);
      fake.calls.push({
        method: "SetPersonParticipation",
        bearer: bearerOf(ctx) ?? null,
      });
      if (!fake.honours(bearerOf(ctx))) {
        throw new ConnectError("not signed in", Code.Unauthenticated);
      }
      if (extended.forceNextRoleChangeFailure) {
        extended.forceNextRoleChangeFailure = false;
        throw new ConnectError(
          "the band forced this one to fail",
          Code.PermissionDenied,
        );
      }
      const admin = fake.user.admin;
      if (!admin && !extended.canInvite) {
        throw new ConnectError("not allowed", Code.PermissionDenied);
      }
      const target = fake.people.find((p) => p.personId === req.personId);
      if (!target) {
        throw new ConnectError("person not found", Code.NotFound);
      }
      if (
        !admin &&
        (!mayAssign(false, target.participationType) ||
          !mayAssign(false, req.participationType))
      ) {
        throw new ConnectError(
          "You may not modify a writer or crew leader",
          Code.PermissionDenied,
        );
      }
      const next = create(PersonSchema, {
        ...target,
        participationType: req.participationType,
        wristband: req.wristband || undefined,
      });
      fake.people = fake.people.map((p) =>
        p.personId === req.personId ? next : p,
      );
      return create(SetPersonParticipationResponseSchema);
    });

    router.rpc(ImsService.method.removePersonFromEvent, async (req, ctx) => {
      await delay(WRITE_DELAY_MS);
      fake.calls.push({
        method: "RemovePersonFromEvent",
        bearer: bearerOf(ctx) ?? null,
      });
      if (!fake.honours(bearerOf(ctx))) {
        throw new ConnectError("not signed in", Code.Unauthenticated);
      }
      const admin = fake.user.admin;
      if (!admin && !extended.canInvite) {
        throw new ConnectError("not allowed", Code.PermissionDenied);
      }
      const target = fake.people.find((p) => p.personId === req.personId);
      if (target && !admin && !mayAssign(false, target.participationType)) {
        throw new ConnectError(
          "You may not modify a writer or crew leader",
          Code.PermissionDenied,
        );
      }
      fake.people = fake.people.filter((p) => p.personId !== req.personId);
      return create(RemovePersonFromEventResponseSchema);
    });

    router.rpc(ImsService.method.createPerson, async (req, ctx) => {
      await delay(WRITE_DELAY_MS);
      fake.calls.push({
        method: "CreatePerson",
        bearer: bearerOf(ctx) ?? null,
      });
      if (!fake.honours(bearerOf(ctx))) {
        throw new ConnectError("not signed in", Code.Unauthenticated);
      }
      const admin = fake.user.admin;
      if (!admin && !extended.canInvite) {
        throw new ConnectError("not allowed", Code.PermissionDenied);
      }
      // An inviter's create lands as a reporter, whatever rung it asked for.
      const participationType = admin
        ? req.participationType
        : ParticipationType.REPORTER;
      const nextId = Math.max(100, ...fake.people.map((p) => p.personId)) + 1;
      const hasPassword = req.password !== "" || req.useDefaultPassword;
      const person = create(PersonSchema, {
        personId: nextId,
        handle: req.handle || undefined,
        name: req.name || undefined,
        email: req.email || undefined,
        phone: req.phone || undefined,
        hasPassword,
        isAdmin: false,
        wristband: req.wristband || undefined,
        participationType:
          req.eventId !== undefined
            ? participationType
            : ParticipationType.UNSPECIFIED,
        crews: [],
      });
      fake.people = [...fake.people, person];
      return create(CreatePersonResponseSchema, { person });
    });

    router.rpc(ImsService.method.listMyCrews, (_req, ctx) => {
      fake.calls.push({ method: "ListMyCrews", bearer: bearerOf(ctx) ?? null });
      if (!fake.honours(bearerOf(ctx))) {
        throw new ConnectError("not signed in", Code.Unauthenticated);
      }
      const crews = extended.crews.filter((c) =>
        c.members.some(
          (m) => m.person?.personId === fake.user.personId && m.isLeader,
        ),
      );
      return create(ListMyCrewsResponseSchema, { crews });
    });

    router.rpc(ImsService.method.setMyCrewMembership, async (req, ctx) => {
      await delay(WRITE_DELAY_MS);
      fake.calls.push({
        method: "SetMyCrewMembership",
        bearer: bearerOf(ctx) ?? null,
      });
      if (!fake.honours(bearerOf(ctx))) {
        throw new ConnectError("not signed in", Code.Unauthenticated);
      }
      // Leaders are admin-managed (ListCrews/SetCrewMembership, 3d.2); a
      // crew leader here may only add/remove a plain member.
      if (!fake.user.admin && req.isLeader) {
        throw new ConnectError(
          "leaders are admin-managed",
          Code.PermissionDenied,
        );
      }
      const crew = extended.crews.find((c) => c.slug === req.crewSlug);
      if (!crew) {
        throw new ConnectError("crew not found", Code.NotFound);
      }
      const isLeaderHere = crew.members.some(
        (m) => m.person?.personId === fake.user.personId && m.isLeader,
      );
      if (!fake.user.admin && !isLeaderHere) {
        throw new ConnectError("not this crew's leader", Code.PermissionDenied);
      }
      const person = fake.people.find((p) => p.personId === req.personId);
      const ref = create(PersonRefSchema, {
        personId: req.personId,
        handle: person?.handle,
        name: person?.name,
      });
      const withoutTarget = crew.members.filter(
        (m) => m.person?.personId !== req.personId,
      );
      const nextMembers = req.remove
        ? withoutTarget
        : [
            ...withoutTarget,
            create(CrewMemberSchema, { person: ref, isLeader: req.isLeader }),
          ];
      const nextCrew = create(CrewSchema, { ...crew, members: nextMembers });
      extended.crews = extended.crews.map((c) =>
        c.slug === req.crewSlug ? nextCrew : c,
      );
      // Keeps the roster's own crew chips (ListPersonnel) in step with My crews.
      if (person) {
        const withoutCrew = person.crews.filter(
          (c) => c.crewSlug !== req.crewSlug,
        );
        const nextPersonCrews = req.remove
          ? withoutCrew
          : [
              ...withoutCrew,
              create(PersonCrewSchema, {
                crewName: crew.name ?? req.crewSlug,
                crewSlug: req.crewSlug,
                isLeader: req.isLeader,
              }),
            ];
        fake.people = fake.people.map((p) =>
          p.personId === req.personId
            ? create(PersonSchema, { ...p, crews: nextPersonCrews })
            : p,
        );
      }
      return create(SetMyCrewMembershipResponseSchema);
    });
  };
  return extended;
}
