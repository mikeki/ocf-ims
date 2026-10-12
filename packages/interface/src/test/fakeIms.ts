// SPDX-License-Identifier: Apache-2.0

import { create, type MessageInitShape, toJson } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import { PersonRefSchema } from "@ocf-ims/protocol-buffers/ocf/ims/common/v1/person_ref_pb";
import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import { AreaSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { Crew } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/crew_pb";
import {
  CrewMemberSchema,
  CrewSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/crew_pb";
import type { Incident } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import {
  IncidentLocationSchema,
  IncidentPersonSchema,
  IncidentPriority,
  IncidentSchema,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import { IncidentTypeSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { Metrics } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/metrics_pb";
import { MetricsSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/metrics_pb";
import type { Notification } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/notification_pb";
import type { Outcome } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/outcome_pb";
import { OutcomeSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/outcome_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  ParticipationType,
  PersonCrewSchema,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { Report } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import { ReportSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import {
  CreateAreaResponseSchema,
  ListAreasResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/area_pb";
import {
  AccessForEventSchema,
  GetAuthStatusResponseSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  RefreshTokenResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/auth_pb";
import {
  ListMyCrewsResponseSchema,
  type SetMyCrewMembershipRequest,
  SetMyCrewMembershipResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/crew_pb";
import { ListEventsResponseSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/event_pb";
import type {
  AttachPersonToIncidentRequest,
  DetachPersonFromIncidentRequest,
  RequestReportRequest,
  UpdateIncidentJournalEntryRequest,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import {
  AttachPersonToIncidentResponseSchema,
  CreateIncidentResponseSchema,
  DetachPersonFromIncidentResponseSchema,
  GetIncidentResponseSchema,
  type IncidentUpdate,
  IncidentUpdateSchema,
  type IncidentView,
  IncidentViewSchema,
  ListIncidentsResponseSchema,
  RequestReportResponseSchema,
  UpdateIncidentJournalEntryResponseSchema,
  type UpdateIncidentRequest,
  UpdateIncidentResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import {
  ListIncidentTypesResponseSchema,
  ProposeIncidentTypeResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_type_pb";
import {
  type GetMetricsRequest,
  GetMetricsResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/metrics_pb";
import {
  ListNotificationsResponseSchema,
  MarkAllNotificationsReadResponseSchema,
  MarkNotificationReadResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/notification_pb";
import {
  ListOutcomesResponseSchema,
  ProposeOutcomeResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/outcome_pb";
import {
  type CreatePersonRequest,
  CreatePersonResponseSchema,
  type ListPersonnelRequest,
  ListPersonnelResponseSchema,
  type SetPersonParticipationRequest,
  SetPersonParticipationResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/person_pb";
import { ChangeOwnPasswordResponseSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/profile_pb";
import {
  RegisterPushDeviceResponseSchema,
  UnregisterPushDeviceResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/push_pb";
import {
  CreateReportResponseSchema,
  GetReportResponseSchema,
  ListReportsResponseSchema,
  type ReportView,
  ReportViewSchema,
  UpdateReportJournalEntryResponseSchema,
  type UpdateReportRequest,
  UpdateReportResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import {
  type EventPoke,
  EventPokeKind,
  type WatchEventRequest,
  WatchEventResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/stream_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { makeEmptyMetrics, makeOutcome } from "@/test/fixtures";

// A programmable in-memory ImsService for createRouterTransport (plan 09l): the
// session RPCs with the server's semantics — Login issues an access token and
// either a body refresh token or the "cookie" (a field here, since there is no
// browser), RefreshToken applies body-wins-cookie-fallback, GetAuthStatus
// tolerates an anonymous caller, Logout clears the cookie — plus the data RPCs
// the screens read, and (09r) the five write RPCs with the server's semantics:
// a granted reporter's update must be journal-only, a proposed type's name
// collision resolves to the existing id, a writer's area is a proposal, and
// the personnel typeahead answers nothing under two characters. Behaviours
// flip a method into a failure mode so every branch can be exercised.

export type Behaviour = "ok" | "unauthenticated" | "unavailable";
/** For the read RPCs that a screen can also see PermissionDenied from. */
export type ListBehaviour = "ok" | "forbidden" | "unavailable";

export type ReportWriteShape = "summary" | "incident" | "entry";
export type ReportWriteBehaviour =
  | ListBehaviour
  | Partial<Record<ReportWriteShape, ListBehaviour>>;

export interface FakeUser {
  email: string;
  password: string;
  handle: string;
  personId: number;
  admin: boolean;
  /** Flipped false by a successful ChangeOwnPassword (plan 09n T2/T12). */
  usingDefaultPassword: boolean;
  /** Drives AccessForEvent.readAreas on GetAuthStatus (plan 09n T12). */
  readAreas: boolean;
  /** Drives AccessForEvent.writeIncidents (an admin always has it), and the write RPCs' gate (09r). */
  writeIncidents: boolean;
  /** Drives AccessForEvent.writeReports and the report writes' gate (09t); a writer has it too. */
  writeReports: boolean;
  /** Drives AccessForEvent.attachFiles (09s); a writer has it too. */
  attachFiles: boolean;
  /** Drives AccessForEvent.inviteReporters (an admin always has it): the roster's inviter (53a). */
  inviteReporters: boolean;
}

/** The minimal shape ListEvents needs — enough to build an Event via create(). */
export interface FakeEvent {
  id: number;
  name?: string;
}

export interface FakeCall {
  method: string;
  /** The Authorization header the call carried, or null. */
  bearer: string | null;
}

export interface FakeImsOptions {
  clock?: () => number;
  accessTtlMs?: number;
  user?: Partial<FakeUser>;
}

export interface FakeIms {
  routes(router: ConnectRouter): void;
  calls: FakeCall[];
  callsOf(method: string): FakeCall[];
  behaviour: {
    login: "ok" | "throttled";
    refresh: Behaviour;
    getAuthStatus: Behaviour;
    logout: "ok" | "unavailable";
    listEvents: Behaviour;
    changeOwnPassword: "ok" | "unavailable";
    listIncidents: ListBehaviour;
    getIncident: ListBehaviour;
    listReports: ListBehaviour;
    getReport: ListBehaviour;
    listAreas: ListBehaviour;
    listIncidentTypes: ListBehaviour;
    listPersonnel: ListBehaviour;
    createIncident: ListBehaviour;
    updateIncident: ListBehaviour;
    attachPersonToIncident: ListBehaviour;
    detachPersonFromIncident: ListBehaviour;
    updateIncidentJournalEntry: ListBehaviour;
    listOutcomes: ListBehaviour;
    proposeOutcome: ListBehaviour;
    proposeIncidentType: ListBehaviour;
    createArea: ListBehaviour;
    createReport: ListBehaviour;
    /** One behaviour for every shape, or one per shape: summary, incident link, journal entry. */
    updateReport: ReportWriteBehaviour;
    requestReport: ListBehaviour;
    listNotifications: ListBehaviour;
    markNotificationRead: ListBehaviour;
    markAllNotificationsRead: ListBehaviour;
    registerPushDevice: ListBehaviour;
    unregisterPushDevice: ListBehaviour;
    watchEvent: ListBehaviour;
    setParticipation: ListBehaviour;
    createPerson: ListBehaviour;
    setMyCrewMembership: ListBehaviour;
    getMetrics: ListBehaviour;
  };
  /** The WatchEvent streams open right now (09v). */
  openStreams: WatchEventRequest[];
  /** Every WatchEvent ever opened. */
  streamRequests: WatchEventRequest[];
  /** Delivers a poke on every open stream watching its event. */
  poke(poke: Partial<EventPoke> & { eventId: number }): void;
  /** Ends every open stream: cleanly, or with the error. */
  endStreams(error?: ConnectError): void;
  user: FakeUser;
  /** Programmable ListNotifications data (09u); `read` is flipped by the mark RPCs. */
  notifications: Notification[];
  /** The Expo push tokens registered for the user (09u). */
  pushDevices: string[];
  /** Programmable ListPersonnel data (09r; the roster modes, 09aa); every mode reads it, with the wire's field gating. */
  people: Person[];
  /** The crews ListMyCrews filters by the caller's leadership and SetMyCrewMembership edits (09aa). */
  crews: Crew[];
  /** Programmable GetMetrics data: a Metrics per event id; an event with none answers the empty aggregate. */
  metrics: Record<number, Metrics | undefined>;
  /** Every GetMetrics request received. */
  getMetricsRequests: GetMetricsRequest[];
  /** Every ListPersonnel request received (09aa). */
  listPersonnelRequests: ListPersonnelRequest[];
  /** Every SetPersonParticipation request received, refused ones included (09aa). */
  setParticipationRequests: SetPersonParticipationRequest[];
  /** Every CreatePerson request received (09aa). */
  createPersonRequests: CreatePersonRequest[];
  /** Every SetMyCrewMembership request received (09aa). */
  setMyCrewMembershipRequests: SetMyCrewMembershipRequest[];
  /** Every UpdateIncident request received, for wire-shape assertions (09r). */
  updateRequests: UpdateIncidentRequest[];
  /** Every UpdateReport request received (09t). */
  updateReportRequests: UpdateReportRequest[];
  /** Every RequestReport request received (09t). */
  requestReportRequests: RequestReportRequest[];
  /** Every AttachPersonToIncident request received (plan 09y). */
  attachRequests: AttachPersonToIncidentRequest[];
  /** Every DetachPersonFromIncident request received (plan 09y). */
  detachRequests: DetachPersonFromIncidentRequest[];
  /** Every UpdateIncidentJournalEntry request received (plan 09y). */
  entryUpdateRequests: UpdateIncidentJournalEntryRequest[];
  /** Programmable ListOutcomes/ProposeOutcome data (plan 09y); seeded via makeOutcome. */
  outcomes: Outcome[];
  /** Programmable ListEvents data (plan 09n T12); default matches the previous hardcoded response. */
  events: FakeEvent[];
  /** Programmable ListIncidents/GetIncident data (plan 09n T12): a flat list, filtered by `incident.eventId`. */
  incidents: IncidentView[];
  /** Programmable ListReports/GetReport data; not scoped by event (a Report carries no event id), so one event per test. */
  reports: ReportView[];
  /** Programmable ListAreas data; the fake doesn't scope areas by event (keep it small — one event per test). */
  areas: Area[];
  /** Programmable ListIncidentTypes data (a global taxonomy, so no event scoping either). */
  incidentTypes: IncidentType[];
  /** The refresh "cookie" a web Login set and Logout clears. */
  cookieRefreshToken: string | undefined;
  /** Registers a valid refresh token (as if a Login had issued it) and returns it. */
  issueRefreshToken(): string;
  /** Every issued access token becomes invalid, as if it expired. */
  expireAccessTokens(): void;
  /** Every issued refresh token becomes invalid. */
  expireRefreshTokens(): void;
  /** Is this access token one the fake issued and still honours? */
  honours(accessToken: string | undefined): boolean;
}

export function createFakeIms(options: FakeImsOptions = {}): FakeIms {
  const clock = options.clock ?? Date.now;
  const accessTtlMs = options.accessTtlMs ?? 15 * 60 * 1000;
  const accessTokens = new Map<string, number>();
  const refreshTokens = new Set<string>();
  let counter = 0;

  const fake: FakeIms = {
    calls: [],
    callsOf: (method) => fake.calls.filter((c) => c.method === method),
    behaviour: {
      login: "ok",
      refresh: "ok",
      getAuthStatus: "ok",
      logout: "ok",
      listEvents: "ok",
      changeOwnPassword: "ok",
      listIncidents: "ok",
      getIncident: "ok",
      listReports: "ok",
      getReport: "ok",
      listAreas: "ok",
      listIncidentTypes: "ok",
      listPersonnel: "ok",
      createIncident: "ok",
      updateIncident: "ok",
      attachPersonToIncident: "ok",
      detachPersonFromIncident: "ok",
      updateIncidentJournalEntry: "ok",
      listOutcomes: "ok",
      proposeOutcome: "ok",
      proposeIncidentType: "ok",
      createArea: "ok",
      createReport: "ok",
      updateReport: "ok",
      requestReport: "ok",
      listNotifications: "ok",
      markNotificationRead: "ok",
      markAllNotificationsRead: "ok",
      registerPushDevice: "ok",
      unregisterPushDevice: "ok",
      watchEvent: "ok",
      setParticipation: "ok",
      createPerson: "ok",
      setMyCrewMembership: "ok",
      getMetrics: "ok",
    },
    openStreams: [],
    streamRequests: [],
    poke(poke) {
      for (const stream of streams) {
        if (stream.req.eventIds.includes(poke.eventId)) {
          stream.push({ kind: "poke", poke });
        }
      }
    },
    endStreams(error) {
      for (const stream of [...streams]) {
        stream.push({ kind: "end", error });
      }
    },
    notifications: [],
    pushDevices: [],
    user: {
      email: "dee@example.org",
      password: "correct horse",
      handle: "Dee",
      personId: 42,
      admin: false,
      usingDefaultPassword: false,
      readAreas: true,
      writeIncidents: false,
      writeReports: false,
      attachFiles: false,
      inviteReporters: false,
      ...options.user,
    },
    events: [{ id: 1, name: "2026" }],
    incidents: [],
    reports: [],
    areas: [],
    incidentTypes: [],
    people: [],
    crews: [],
    metrics: {},
    getMetricsRequests: [],
    listPersonnelRequests: [],
    setParticipationRequests: [],
    createPersonRequests: [],
    setMyCrewMembershipRequests: [],
    updateRequests: [],
    updateReportRequests: [],
    requestReportRequests: [],
    attachRequests: [],
    detachRequests: [],
    entryUpdateRequests: [],
    outcomes: [
      makeOutcome({ id: 1, name: "Resolved on scene" }),
      makeOutcome({ id: 2, name: "Referred to White Bird" }),
    ],
    cookieRefreshToken: undefined,
    issueRefreshToken() {
      counter += 1;
      const token = `refresh-${counter}`;
      refreshTokens.add(token);
      return token;
    },
    expireAccessTokens: () => accessTokens.clear(),
    expireRefreshTokens: () => refreshTokens.clear(),
    honours: (token) => {
      if (token === undefined) {
        return false;
      }
      const expiresAt = accessTokens.get(token);
      return expiresAt !== undefined && clock() < expiresAt;
    },
    routes(router) {
      router.service(ImsService, {
        login(req, ctx) {
          record("Login", ctx);
          if (fake.behaviour.login === "throttled") {
            throw new ConnectError(
              "too many failed login attempts, please wait and try again",
              Code.ResourceExhausted,
              { "Retry-After": "7" },
            );
          }
          if (
            req.email.toLowerCase() !== fake.user.email.toLowerCase() ||
            req.password !== fake.user.password
          ) {
            throw new ConnectError(
              "failed login attempt (bad credentials)",
              Code.Unauthenticated,
            );
          }
          const access = issueAccessToken();
          const refresh = fake.issueRefreshToken();
          if (req.returnRefreshToken) {
            return create(LoginResponseSchema, {
              ...access,
              refreshToken: refresh,
              refreshExpiresAt: timestampFromDate(
                new Date(clock() + 7 * 24 * 60 * 60 * 1000),
              ),
            });
          }
          fake.cookieRefreshToken = refresh;
          return create(LoginResponseSchema, access);
        },
        refreshToken(req, ctx) {
          record("RefreshToken", ctx);
          if (fake.behaviour.refresh === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (fake.behaviour.refresh === "unauthenticated") {
            throw new ConnectError(
              "failed to authenticate refresh token",
              Code.Unauthenticated,
            );
          }
          const token = req.refreshToken || fake.cookieRefreshToken;
          if (!token || !refreshTokens.has(token)) {
            throw new ConnectError(
              "failed to authenticate refresh token",
              Code.Unauthenticated,
            );
          }
          return create(RefreshTokenResponseSchema, issueAccessToken());
        },
        getAuthStatus(req, ctx) {
          record("GetAuthStatus", ctx);
          if (fake.behaviour.getAuthStatus === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            return create(GetAuthStatusResponseSchema, {
              authenticated: false,
            });
          }
          const eventAccess: Record<number, ReturnType<typeof accessFor>> = {};
          if (req.eventId !== undefined) {
            eventAccess[req.eventId] = accessFor(req.eventId);
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
        },
        logout(_req, ctx) {
          record("Logout", ctx);
          if (fake.behaviour.logout === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          fake.cookieRefreshToken = undefined;
          return create(LogoutResponseSchema);
        },
        listEvents(_req, ctx) {
          record("ListEvents", ctx);
          if (fake.behaviour.listEvents === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          return create(ListEventsResponseSchema, {
            events: fake.events,
          });
        },
        changeOwnPassword(req, ctx) {
          record("ChangeOwnPassword", ctx);
          if (fake.behaviour.changeOwnPassword === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          if (req.password.length < 8) {
            throw new ConnectError(
              "password must be at least 8 characters",
              Code.InvalidArgument,
            );
          }
          fake.user.usingDefaultPassword = false;
          return create(ChangeOwnPasswordResponseSchema);
        },
        listIncidents(req, ctx) {
          record("ListIncidents", ctx);
          if (fake.behaviour.listIncidents === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          if (fake.behaviour.listIncidents === "forbidden") {
            throw new ConnectError("not allowed", Code.PermissionDenied);
          }
          if (!fake.events.some((e) => e.id === req.eventId)) {
            throw new ConnectError("no such event", Code.NotFound);
          }
          return create(ListIncidentsResponseSchema, {
            incidents: fake.incidents.filter(
              (v) => v.incident?.eventId === req.eventId,
            ),
          });
        },
        getIncident(req, ctx) {
          record("GetIncident", ctx);
          if (fake.behaviour.getIncident === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          if (fake.behaviour.getIncident === "forbidden") {
            throw new ConnectError("not allowed", Code.PermissionDenied);
          }
          const view = fake.incidents.find(
            (v) =>
              v.incident?.eventId === req.eventId &&
              v.incident?.number === req.incidentNumber,
          );
          if (!view) {
            throw new ConnectError("no such incident", Code.NotFound);
          }
          return create(GetIncidentResponseSchema, { incident: view });
        },
        listReports(_req, ctx) {
          record("ListReports", ctx);
          if (fake.behaviour.listReports === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          if (fake.behaviour.listReports === "forbidden") {
            throw new ConnectError("not allowed", Code.PermissionDenied);
          }
          return create(ListReportsResponseSchema, { reports: fake.reports });
        },
        getReport(req, ctx) {
          record("GetReport", ctx);
          if (fake.behaviour.getReport === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          if (fake.behaviour.getReport === "forbidden") {
            throw new ConnectError("not allowed", Code.PermissionDenied);
          }
          const view = fake.reports.find(
            (v) => v.report?.number === req.reportNumber,
          );
          if (!view) {
            throw new ConnectError("no such report", Code.NotFound);
          }
          return create(GetReportResponseSchema, { report: view });
        },
        listAreas(_req, ctx) {
          record("ListAreas", ctx);
          if (fake.behaviour.listAreas === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          if (fake.behaviour.listAreas === "forbidden") {
            throw new ConnectError("not allowed", Code.PermissionDenied);
          }
          return create(ListAreasResponseSchema, { areas: fake.areas });
        },
        listIncidentTypes(_req, ctx) {
          record("ListIncidentTypes", ctx);
          if (fake.behaviour.listIncidentTypes === "unavailable") {
            throw new ConnectError("redeploying", Code.Unavailable);
          }
          if (!fake.honours(bearerOf(ctx))) {
            throw new ConnectError("not signed in", Code.Unauthenticated);
          }
          if (fake.behaviour.listIncidentTypes === "forbidden") {
            throw new ConnectError("not allowed", Code.PermissionDenied);
          }
          return create(ListIncidentTypesResponseSchema, {
            incidentTypes: fake.incidentTypes,
          });
        },
        listPersonnel(req, ctx) {
          record("ListPersonnel", ctx);
          fake.listPersonnelRequests.push(req);
          guard(fake.behaviour.listPersonnel, ctx);
          const view = {
            viewerId: fake.user.personId,
            admin: fake.user.admin,
            eventScoped: req.eventId !== undefined,
          };
          // Precedence, highest first (ListPersonnelRequest's own doc
          // comment): query, then person_ids, then all, then the directory.
          if (req.query !== undefined) {
            // The server's typeahead answers nothing below two characters.
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
                // The typeahead rows carry no has_password (personnel.go).
                .map((p) =>
                  create(PersonSchema, {
                    ...shapePerson(p, view),
                    hasPassword: false,
                  }),
                ),
            });
          }
          if (req.personIds.length > 0) {
            return create(ListPersonnelResponseSchema, {
              people: fake.people
                .filter((p) => req.personIds.includes(p.personId))
                .map((p) => shapePerson(p, view)),
            });
          }
          if (req.all) {
            // The event roster (event_id set, show_all false) opens to an
            // inviter; the global listing and show_all stay admin-only.
            const isEventRoster = view.eventScoped && !req.showAll;
            if (
              !fake.user.admin &&
              !(isEventRoster && fake.user.inviteReporters)
            ) {
              throw new ConnectError("not allowed", Code.PermissionDenied);
            }
            return create(ListPersonnelResponseSchema, {
              people: fake.people.map((p) => shapePerson(p, view)),
            });
          }
          // None set: the login directory, identity and picture only.
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
        },
        setPersonParticipation(req, ctx) {
          record("SetPersonParticipation", ctx);
          fake.setParticipationRequests.push(req);
          guard(fake.behaviour.setParticipation, ctx);
          const admin = fake.user.admin;
          if (!admin && !fake.user.inviteReporters) {
            throw new ConnectError("not allowed", Code.PermissionDenied);
          }
          const target = fake.people.find((p) => p.personId === req.personId);
          if (!target) {
            throw new ConnectError("person not found", Code.NotFound);
          }
          // The ceiling (53b): an inviter sends reporter / volunteer / public
          // / not_present, and never on a target already above it.
          if (
            !admin &&
            (aboveCeiling(target.participationType) ||
              aboveCeiling(req.participationType) ||
              req.participationType === ParticipationType.EJECTED)
          ) {
            throw new ConnectError(
              "You may not modify a writer or crew leader",
              Code.PermissionDenied,
            );
          }
          fake.people = fake.people.map((p) =>
            p.personId === req.personId
              ? create(PersonSchema, {
                  ...p,
                  participationType: req.participationType,
                  wristband: req.wristband || undefined,
                })
              : p,
          );
          return create(SetPersonParticipationResponseSchema);
        },
        createPerson(req, ctx) {
          record("CreatePerson", ctx);
          fake.createPersonRequests.push(req);
          guard(fake.behaviour.createPerson, ctx);
          const admin = fake.user.admin;
          if (!admin && !fake.user.inviteReporters) {
            throw new ConnectError("not allowed", Code.PermissionDenied);
          }
          // An inviter's create lands as a reporter, whatever rung it asked for.
          const participationType = admin
            ? req.participationType
            : ParticipationType.REPORTER;
          const person = create(PersonSchema, {
            personId: Math.max(100, ...fake.people.map((p) => p.personId)) + 1,
            handle: req.handle || undefined,
            name: req.name || undefined,
            email: req.email || undefined,
            phone: req.phone || undefined,
            hasPassword: req.password !== "" || req.useDefaultPassword,
            wristband: req.wristband || undefined,
            participationType:
              req.eventId !== undefined
                ? participationType
                : ParticipationType.UNSPECIFIED,
            crews: [],
          });
          fake.people = [...fake.people, person];
          return create(CreatePersonResponseSchema, { person });
        },
        listMyCrews(_req, ctx) {
          record("ListMyCrews", ctx);
          guard("ok", ctx);
          return create(ListMyCrewsResponseSchema, {
            crews: fake.crews.filter((c) =>
              c.members.some(
                (m) => m.person?.personId === fake.user.personId && m.isLeader,
              ),
            ),
          });
        },
        setMyCrewMembership(req, ctx) {
          record("SetMyCrewMembership", ctx);
          fake.setMyCrewMembershipRequests.push(req);
          guard(fake.behaviour.setMyCrewMembership, ctx);
          // Leaders are admin-managed (3d.2); a leader adds / removes plain members.
          if (!fake.user.admin && req.isLeader) {
            throw new ConnectError(
              "leaders are admin-managed",
              Code.PermissionDenied,
            );
          }
          const crew = fake.crews.find((c) => c.slug === req.crewSlug);
          if (!crew) {
            throw new ConnectError("crew not found", Code.NotFound);
          }
          const leads = crew.members.some(
            (m) => m.person?.personId === fake.user.personId && m.isLeader,
          );
          if (!fake.user.admin && !leads) {
            throw new ConnectError(
              "not this crew's leader",
              Code.PermissionDenied,
            );
          }
          const person = fake.people.find((p) => p.personId === req.personId);
          const others = crew.members.filter(
            (m) => m.person?.personId !== req.personId,
          );
          const members = req.remove
            ? others
            : [
                ...others,
                create(CrewMemberSchema, {
                  person: create(PersonRefSchema, {
                    personId: req.personId,
                    handle: person?.handle,
                    name: person?.name,
                  }),
                  isLeader: req.isLeader,
                }),
              ];
          fake.crews = fake.crews.map((c) =>
            c.slug === req.crewSlug ? create(CrewSchema, { ...c, members }) : c,
          );
          // The roster's own crew chips follow My crews.
          if (person) {
            const rest = person.crews.filter(
              (c) => c.crewSlug !== req.crewSlug,
            );
            const crews = req.remove
              ? rest
              : [
                  ...rest,
                  create(PersonCrewSchema, {
                    crewName: crew.name ?? req.crewSlug,
                    crewSlug: req.crewSlug,
                    isLeader: req.isLeader,
                  }),
                ];
            fake.people = fake.people.map((p) =>
              p.personId === req.personId
                ? create(PersonSchema, { ...p, crews })
                : p,
            );
          }
          return create(SetMyCrewMembershipResponseSchema);
        },
        createIncident(req, ctx) {
          record("CreateIncident", ctx);
          guard(fake.behaviour.createIncident, ctx);
          requireWriter();
          if (!fake.events.some((e) => e.id === req.eventId)) {
            throw new ConnectError("event not found", Code.NotFound);
          }
          const update = req.incident;
          if (!update) {
            throw new ConnectError(
              "incident is required",
              Code.InvalidArgument,
            );
          }
          if ((update.summary ?? "").length > 1024) {
            throw new ConnectError(
              "incident.summary: value length must be at most 1024 characters",
              Code.InvalidArgument,
            );
          }
          const number =
            Math.max(
              0,
              ...fake.incidents
                .filter((v) => v.incident?.eventId === req.eventId)
                .map((v) => v.incident?.number ?? 0),
            ) + 1;
          const now = timestampFromDate(new Date(clock()));
          const view = create(IncidentViewSchema, {
            viewerMayAddJournal: true,
            incident: create(IncidentSchema, {
              event: fake.events.find((e) => e.id === req.eventId)?.name,
              eventId: req.eventId,
              number,
              created: now,
              started: now,
              lastModified: now,
              state: IncidentState.OPEN,
              priority:
                update.priority === IncidentPriority.UNSPECIFIED
                  ? IncidentPriority.NORMAL
                  : update.priority,
              summary: update.summary,
              createdBy: {
                personId: fake.user.personId,
                handle: fake.user.handle,
              },
              location: update.location,
              incidentTypeIds: update.incidentTypeIds?.values ?? [],
              journalEntries: entriesOf(update, now),
            }),
          });
          fake.incidents = [...fake.incidents, view];
          return create(CreateIncidentResponseSchema, {
            incidentNumber: number,
          });
        },
        updateIncident(req, ctx) {
          record("UpdateIncident", ctx);
          guard(fake.behaviour.updateIncident, ctx);
          fake.updateRequests.push(req);
          const view = fake.incidents.find(
            (v) =>
              v.incident?.eventId === req.eventId &&
              v.incident?.number === req.incidentNumber,
          );
          const update = req.update;
          if (!update) {
            throw new ConnectError("update is required", Code.InvalidArgument);
          }
          // The server's 52f rule: no write bit → a grant AND a journal-only payload.
          if (!fake.user.admin && !fake.user.writeIncidents) {
            if (!view?.viewerMayAddJournal) {
              throw new ConnectError("not allowed", Code.PermissionDenied);
            }
            if (!journalOnly(update)) {
              throw new ConnectError(
                "a granted reporter may only add journal entries to this incident",
                Code.PermissionDenied,
              );
            }
          }
          if (!view?.incident) {
            throw new ConnectError("incident not found", Code.NotFound);
          }
          const now = timestampFromDate(new Date(clock()));
          const incident = view.incident;
          const withFields = applyFieldWrites(incident, update, now);
          const next = create(IncidentViewSchema, {
            ...view,
            incident: create(IncidentSchema, {
              ...withFields,
              journalEntries: [
                ...incident.journalEntries,
                ...entriesOf(update, now),
              ],
            }),
          });
          fake.incidents = fake.incidents.map((v) => (v === view ? next : v));
          return create(UpdateIncidentResponseSchema);
        },
        attachPersonToIncident(req, ctx) {
          record("AttachPersonToIncident", ctx);
          guard(fake.behaviour.attachPersonToIncident, ctx);
          requireWriter();
          fake.attachRequests.push(req);
          const view = fake.incidents.find(
            (v) =>
              v.incident?.eventId === req.eventId &&
              v.incident?.number === req.incidentNumber,
          );
          if (!view?.incident) {
            throw new ConnectError("incident not found", Code.NotFound);
          }
          const person = fake.people.find((p) => p.personId === req.personId);
          if (!person) {
            throw new ConnectError("person not found", Code.NotFound);
          }
          const incident = view.incident;
          const attached = incident.people.some(
            (p) => p.person?.personId === req.personId,
          );
          const involvement =
            req.involvement === "" ? undefined : req.involvement;
          const row = create(IncidentPersonSchema, {
            person: {
              personId: person.personId,
              handle: person.handle,
              name: person.name,
            },
            involvement,
            grantedAccess: req.grantedAccess,
            // has_event_access mirrors whether the person has any standing in
            // the event at all — a populated participation type.
            hasEventAccess:
              person.participationType !== ParticipationType.UNSPECIFIED,
          });
          const people = attached
            ? incident.people.map((p) =>
                p.person?.personId === req.personId
                  ? create(IncidentPersonSchema, {
                      ...p,
                      involvement,
                      grantedAccess: req.grantedAccess,
                    })
                  : p,
              )
            : [...incident.people, row];
          const next = create(IncidentViewSchema, {
            ...view,
            incident: create(IncidentSchema, {
              ...incident,
              people,
              lastModified: timestampFromDate(new Date(clock())),
            }),
          });
          fake.incidents = fake.incidents.map((v) => (v === view ? next : v));
          return create(AttachPersonToIncidentResponseSchema);
        },
        detachPersonFromIncident(req, ctx) {
          record("DetachPersonFromIncident", ctx);
          guard(fake.behaviour.detachPersonFromIncident, ctx);
          requireWriter();
          fake.detachRequests.push(req);
          const view = fake.incidents.find(
            (v) =>
              v.incident?.eventId === req.eventId &&
              v.incident?.number === req.incidentNumber,
          );
          if (!view?.incident) {
            throw new ConnectError("incident not found", Code.NotFound);
          }
          const incident = view.incident;
          const next = create(IncidentViewSchema, {
            ...view,
            incident: create(IncidentSchema, {
              ...incident,
              people: incident.people.filter(
                (p) => p.person?.personId !== req.personId,
              ),
              lastModified: timestampFromDate(new Date(clock())),
            }),
          });
          fake.incidents = fake.incidents.map((v) => (v === view ? next : v));
          return create(DetachPersonFromIncidentResponseSchema);
        },
        updateIncidentJournalEntry(req, ctx) {
          record("UpdateIncidentJournalEntry", ctx);
          guard(fake.behaviour.updateIncidentJournalEntry, ctx);
          requireWriter();
          fake.entryUpdateRequests.push(req);
          const view = fake.incidents.find(
            (v) =>
              v.incident?.eventId === req.eventId &&
              v.incident?.number === req.incidentNumber,
          );
          if (!view?.incident) {
            throw new ConnectError("incident not found", Code.NotFound);
          }
          const incident = view.incident;
          const stricken = req.entry?.stricken === true;
          const next = create(IncidentViewSchema, {
            ...view,
            incident: create(IncidentSchema, {
              ...incident,
              journalEntries: incident.journalEntries.map((e) =>
                e.id === req.journalEntryId
                  ? create(JournalEntrySchema, { ...e, stricken })
                  : e,
              ),
              lastModified: timestampFromDate(new Date(clock())),
            }),
          });
          fake.incidents = fake.incidents.map((v) => (v === view ? next : v));
          return create(UpdateIncidentJournalEntryResponseSchema);
        },
        listOutcomes(_req, ctx) {
          record("ListOutcomes", ctx);
          guard(fake.behaviour.listOutcomes, ctx);
          return create(ListOutcomesResponseSchema, {
            outcomes: fake.outcomes,
          });
        },
        proposeOutcome(req, ctx) {
          record("ProposeOutcome", ctx);
          guard(fake.behaviour.proposeOutcome, ctx);
          requireWriter();
          const name = (req.outcome?.name ?? "").trim();
          if (!name) {
            throw new ConnectError(
              "outcome name is required",
              Code.InvalidArgument,
            );
          }
          // A name collision resolves to the existing outcome.
          const existing = fake.outcomes.find(
            (o) => (o.name ?? "").trim().toLowerCase() === name.toLowerCase(),
          );
          if (existing) {
            return create(ProposeOutcomeResponseSchema, {
              outcomeId: existing.id,
            });
          }
          const id = Math.max(0, ...fake.outcomes.map((o) => o.id)) + 1;
          fake.outcomes = [
            ...fake.outcomes,
            create(OutcomeSchema, {
              id,
              name,
              approved: false,
              proposer: { personId: fake.user.personId },
            }),
          ];
          return create(ProposeOutcomeResponseSchema, { outcomeId: id });
        },
        proposeIncidentType(req, ctx) {
          record("ProposeIncidentType", ctx);
          guard(fake.behaviour.proposeIncidentType, ctx);
          requireWriter();
          const name = (req.incidentType?.name ?? "").trim();
          if (!name) {
            throw new ConnectError(
              "incident type name is required",
              Code.InvalidArgument,
            );
          }
          // A name collision resolves to the existing type.
          const existing = fake.incidentTypes.find(
            (t) => (t.name ?? "").trim().toLowerCase() === name.toLowerCase(),
          );
          if (existing) {
            return create(ProposeIncidentTypeResponseSchema, {
              incidentTypeId: existing.id,
            });
          }
          const id = Math.max(0, ...fake.incidentTypes.map((t) => t.id)) + 1;
          fake.incidentTypes = [
            ...fake.incidentTypes,
            create(IncidentTypeSchema, {
              id,
              name,
              approved: false,
              proposer: { personId: fake.user.personId },
            }),
          ];
          return create(ProposeIncidentTypeResponseSchema, {
            incidentTypeId: id,
          });
        },
        createArea(req, ctx) {
          record("CreateArea", ctx);
          guard(fake.behaviour.createArea, ctx);
          requireWriter();
          const name = (req.area?.name ?? "").trim();
          if (!name) {
            throw new ConnectError(
              "area name is required",
              Code.InvalidArgument,
            );
          }
          const existing = fake.areas.find(
            (a) => (a.name ?? "").trim().toLowerCase() === name.toLowerCase(),
          );
          if (existing) {
            throw new ConnectError("area already exists", Code.AlreadyExists);
          }
          const slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          fake.areas = [
            ...fake.areas,
            create(AreaSchema, {
              slug,
              name,
              approved: fake.user.admin,
              proposer: { personId: fake.user.personId },
            }),
          ];
          return create(CreateAreaResponseSchema, { areaSlug: slug });
        },
        createReport(req, ctx) {
          record("CreateReport", ctx);
          guard(fake.behaviour.createReport, ctx);
          requireReportWriter();
          if (!fake.events.some((e) => e.id === req.eventId)) {
            throw new ConnectError("event not found", Code.NotFound);
          }
          const write = req.report;
          if (!write) {
            throw new ConnectError("report is required", Code.InvalidArgument);
          }
          if ((write.summary ?? "").length > 1024) {
            throw new ConnectError(
              "report.summary: value length must be at most 1024 characters",
              Code.InvalidArgument,
            );
          }
          // The link is a foreign key: an unknown incident is NotFound, a private one links.
          const linked = linkedIncident(req.eventId, write.incident);
          const number =
            Math.max(0, ...fake.reports.map((v) => v.report?.number ?? 0)) + 1;
          const now = timestampFromDate(new Date(clock()));
          const view = create(ReportViewSchema, {
            mayEditSummary: true,
            mayAddJournalEntry: true,
            report: create(ReportSchema, {
              event: fake.events.find((e) => e.id === req.eventId)?.name,
              number,
              created: now,
              createdBy: {
                personId: fake.user.personId,
                handle: fake.user.handle,
              },
              summary: write.summary,
              incident: linked?.incident?.number,
              journalEntries: reportEntriesOf(write, now),
            }),
          });
          fake.reports = [...fake.reports, view];
          if (linked) {
            markDelivered(linked, number);
          }
          return create(CreateReportResponseSchema, { reportNumber: number });
        },
        updateReport(req, ctx) {
          record("UpdateReport", ctx);
          const write = req.report;
          const shapes: ReportWriteShape[] = [];
          if (write?.summary !== undefined) {
            shapes.push("summary");
          }
          if (write?.incident !== undefined) {
            shapes.push("incident");
          }
          if (write && write.journalEntries.length > 0) {
            shapes.push("entry");
          }
          for (const shape of shapes.length > 0 ? shapes : ["entry" as const]) {
            guard(reportBehaviourOf(shape), ctx);
          }
          requireReportWriter();
          fake.updateReportRequests.push(req);
          const view = fake.reports.find(
            (v) => v.report?.number === req.reportNumber,
          );
          if (!view?.report) {
            throw new ConnectError("report not found", Code.NotFound);
          }
          if (!write) {
            throw new ConnectError("report is required", Code.InvalidArgument);
          }
          const report = view.report;
          // Editing the summary is the creator's or an admin's.
          if (
            write.summary !== undefined &&
            !fake.user.admin &&
            report.createdBy?.personId !== fake.user.personId
          ) {
            throw new ConnectError(
              "only the report's creator or an admin may edit its summary",
              Code.PermissionDenied,
            );
          }
          const now = timestampFromDate(new Date(clock()));
          // Presence semantics: absent leaves the field; > 0 links, <= 0 detaches.
          let nextIncident = report.incident;
          const appended: ReturnType<typeof reportEntriesOf> = [];
          let linkChanged = false;
          if (write.incident !== undefined) {
            const linked = linkedIncident(req.eventId, write.incident);
            nextIncident = linked?.incident?.number;
            linkChanged = nextIncident !== report.incident;
            if (linkChanged) {
              systemEntryId += 1;
              appended.push(
                create(JournalEntrySchema, {
                  id: systemEntryId,
                  created: now,
                  author: fake.user.handle,
                  systemEntry: true,
                  text:
                    nextIncident !== undefined
                      ? `Linked to incident #${nextIncident}`
                      : `Unlinked from incident #${report.incident}`,
                }),
              );
            }
          }
          const next = create(ReportViewSchema, {
            ...view,
            report: create(ReportSchema, {
              ...report,
              ...(write.summary !== undefined
                ? { summary: write.summary }
                : {}),
              incident: nextIncident,
              journalEntries: [
                ...report.journalEntries,
                ...appended,
                ...reportEntriesOf(write, now),
              ],
            }),
          });
          fake.reports = fake.reports.map((v) => (v === view ? next : v));
          if (linkChanged) {
            if (report.incident !== undefined) {
              fake.incidents = fake.incidents.map((v) => {
                const inc = v.incident;
                return inc && inc.number === report.incident
                  ? create(IncidentViewSchema, {
                      ...v,
                      incident: create(IncidentSchema, {
                        ...inc,
                        reports: inc.reports.filter(
                          (n) => n !== req.reportNumber,
                        ),
                      }),
                    })
                  : v;
              });
            }
            if (nextIncident !== undefined) {
              const target = linkedIncident(req.eventId, nextIncident);
              if (target) {
                markDelivered(target, req.reportNumber);
              }
            }
          }
          return create(UpdateReportResponseSchema);
        },
        updateReportJournalEntry(req, ctx) {
          record("UpdateReportJournalEntry", ctx);
          guard(reportBehaviourOf("entry"), ctx);
          requireReportWriter();
          const view = fake.reports.find(
            (v) => v.report?.number === req.reportNumber,
          );
          if (!view?.report) {
            throw new ConnectError("report not found", Code.NotFound);
          }
          const entry = view.report.journalEntries.find(
            (e) => e.id === req.journalEntryId,
          );
          if (!entry) {
            throw new ConnectError("journal entry not found", Code.NotFound);
          }
          // A reporter may strike only their own entries; a writer or admin any.
          if (
            !fake.user.admin &&
            !fake.user.writeIncidents &&
            entry.author !== fake.user.handle
          ) {
            throw new ConnectError(
              "only the entry's author or a writer may strike it",
              Code.PermissionDenied,
            );
          }
          const stricken = req.entry?.stricken === true;
          const next = create(ReportViewSchema, {
            ...view,
            report: create(ReportSchema, {
              ...view.report,
              journalEntries: view.report.journalEntries.map((e) =>
                e.id === req.journalEntryId
                  ? create(JournalEntrySchema, { ...e, stricken })
                  : e,
              ),
            }),
          });
          fake.reports = fake.reports.map((v) => (v === view ? next : v));
          return create(UpdateReportJournalEntryResponseSchema);
        },
        requestReport(req, ctx) {
          record("RequestReport", ctx);
          guard(fake.behaviour.requestReport, ctx);
          requireWriter();
          fake.requestReportRequests.push(req);
          const view = fake.incidents.find(
            (v) =>
              v.incident?.eventId === req.eventId &&
              v.incident?.number === req.incidentNumber,
          );
          if (!view?.incident) {
            throw new ConnectError("incident not found", Code.NotFound);
          }
          const person = fake.people.find((p) => p.personId === req.personId);
          if (!person && req.personId !== fake.user.personId) {
            throw new ConnectError("person not found", Code.NotFound);
          }
          const now = timestampFromDate(new Date(clock()));
          const incident = view.incident;
          const attached = incident.people.some(
            (p) => p.person?.personId === req.personId,
          );
          const people = attached
            ? incident.people.map((p) =>
                p.person?.personId === req.personId
                  ? { ...p, grantedAccess: true, reportRequested: now }
                  : p,
              )
            : [
                ...incident.people,
                create(IncidentPersonSchema, {
                  person: {
                    personId: req.personId,
                    handle: person?.handle ?? fake.user.handle,
                    name: person?.name,
                  },
                  grantedAccess: true,
                  reportRequested: now,
                }),
              ];
          const next = create(IncidentViewSchema, {
            ...view,
            incident: create(IncidentSchema, {
              ...incident,
              lastModified: now,
              people,
              journalEntries: [
                ...incident.journalEntries,
                create(JournalEntrySchema, {
                  id: 5000 + fake.requestReportRequests.length,
                  created: now,
                  author: fake.user.handle,
                  systemEntry: true,
                  text: `Report requested from ${person?.handle ?? fake.user.handle}`,
                }),
              ],
            }),
          });
          fake.incidents = fake.incidents.map((v) => (v === view ? next : v));
          return create(RequestReportResponseSchema);
        },
        getMetrics(req, ctx) {
          record("GetMetrics", ctx);
          fake.getMetricsRequests.push(req);
          guard(fake.behaviour.getMetrics, ctx);
          requireWriter();
          const held = fake.metrics[req.eventId];
          const base =
            held ??
            makeEmptyMetrics(
              req.eventId,
              fake.events.find((e) => e.id === req.eventId)?.name,
            );
          // The server stamps each answer with the moment it computed it.
          const { $typeName: _typeName, ...held_ } = base;
          const init: MessageInitShape<typeof MetricsSchema> = {
            ...held_,
            generatedAt: timestampFromDate(new Date(clock())),
          };
          const metrics = create(MetricsSchema, init);
          return create(GetMetricsResponseSchema, { metrics });
        },
        listNotifications(_req, ctx) {
          record("ListNotifications", ctx);
          guard(fake.behaviour.listNotifications, ctx);
          return create(ListNotificationsResponseSchema, {
            notifications: fake.notifications,
            unread: BigInt(fake.notifications.filter((n) => !n.read).length),
          });
        },
        markNotificationRead(req, ctx) {
          record("MarkNotificationRead", ctx);
          guard(fake.behaviour.markNotificationRead, ctx);
          const target = fake.notifications.find(
            (n) => n.id === req.notificationId,
          );
          if (!target) {
            throw new ConnectError("notification not found", Code.NotFound);
          }
          target.read = true;
          return create(MarkNotificationReadResponseSchema);
        },
        markAllNotificationsRead(_req, ctx) {
          record("MarkAllNotificationsRead", ctx);
          guard(fake.behaviour.markAllNotificationsRead, ctx);
          for (const n of fake.notifications) {
            n.read = true;
          }
          return create(MarkAllNotificationsReadResponseSchema);
        },
        registerPushDevice(req, ctx) {
          record("RegisterPushDevice", ctx);
          guard(fake.behaviour.registerPushDevice, ctx);
          if (!fake.pushDevices.includes(req.expoPushToken)) {
            fake.pushDevices.push(req.expoPushToken);
          }
          return create(RegisterPushDeviceResponseSchema);
        },
        async *watchEvent(req, ctx) {
          record("WatchEvent", ctx);
          guard(fake.behaviour.watchEvent, ctx);
          fake.streamRequests.push(req);
          const stream = openStream(req, ctx.signal);
          try {
            yield create(WatchEventResponseSchema, {
              poke: {
                kind: EventPokeKind.HEARTBEAT,
                eventId: req.eventIds[0],
                sent: timestampFromDate(new Date(clock())),
              },
            });
            for (;;) {
              const item = await stream.next();
              if (item.kind === "end") {
                if (item.error) {
                  throw item.error;
                }
                return;
              }
              yield create(WatchEventResponseSchema, {
                poke: {
                  kind: EventPokeKind.INCIDENT_CHANGED,
                  sent: timestampFromDate(new Date(clock())),
                  ...item.poke,
                },
              });
            }
          } finally {
            stream.close();
          }
        },
        unregisterPushDevice(req, ctx) {
          record("UnregisterPushDevice", ctx);
          guard(fake.behaviour.unregisterPushDevice, ctx);
          fake.pushDevices = fake.pushDevices.filter(
            (t) => t !== req.expoPushToken,
          );
          return create(UnregisterPushDeviceResponseSchema);
        },
      });
    },
  };

  let systemEntryId = 8000;

  function reportBehaviourOf(shape: ReportWriteShape): ListBehaviour {
    const b = fake.behaviour.updateReport;
    return typeof b === "string" ? b : (b[shape] ?? "ok");
  }

  function requireReportWriter(): void {
    if (
      !fake.user.admin &&
      !fake.user.writeIncidents &&
      !fake.user.writeReports
    ) {
      throw new ConnectError(
        "the requestor does not have EventWriteOwnReports permission on this Event",
        Code.PermissionDenied,
      );
    }
  }

  /** The incident a report write links to, or undefined; an unknown number is NotFound. */
  function linkedIncident(eventId: number, incident: number | undefined) {
    if (incident === undefined || incident <= 0) {
      return undefined;
    }
    const view = fake.incidents.find(
      (v) => v.incident?.eventId === eventId && v.incident?.number === incident,
    );
    if (!view) {
      throw new ConnectError("incident not found", Code.NotFound);
    }
    return view;
  }

  /** The server's read side: the newest report by this person on the incident. */
  function markDelivered(view: IncidentView, reportNumber: number) {
    const incident = view.incident;
    if (!incident) {
      return;
    }
    const next = create(IncidentViewSchema, {
      ...view,
      incident: create(IncidentSchema, {
        ...incident,
        reports: [...incident.reports, reportNumber],
        people: incident.people.map((p) =>
          p.person?.personId === fake.user.personId
            ? { ...p, reportNumber }
            : p,
        ),
      }),
    });
    fake.incidents = fake.incidents.map((v) => (v === view ? next : v));
  }

  /** The journal entries a report write carries, as the server would echo them. */
  function reportEntriesOf(
    write: Report,
    now: ReturnType<typeof timestampFromDate>,
  ) {
    return write.journalEntries.map((e, i) =>
      create(JournalEntrySchema, {
        id:
          2000 +
          fake.reports.length * 10 +
          fake.updateReportRequests.length * 100 +
          i,
        created: now,
        author: fake.user.handle,
        text: e.text,
        mentions: e.mentions.map((ref) => {
          const p = fake.people.find(
            (person) => person.personId === ref.personId,
          );
          return { personId: ref.personId, handle: p?.handle, name: p?.name };
        }),
        onBehalfOf: e.onBehalfOf
          ? (() => {
              const p = fake.people.find(
                (person) => person.personId === e.onBehalfOf?.personId,
              );
              return {
                personId: e.onBehalfOf.personId,
                handle: p?.handle,
                name: p?.name,
              };
            })()
          : undefined,
      }),
    );
  }

  /** The read/write RPCs' shared preamble: availability, sign-in, then the forbidden switch. */
  type StreamItem =
    | { kind: "poke"; poke: Partial<EventPoke> & { eventId: number } }
    | { kind: "end"; error: ConnectError | undefined };
  interface OpenStream {
    req: WatchEventRequest;
    push(item: StreamItem): void;
    next(): Promise<StreamItem>;
    close(): void;
  }
  const streams: OpenStream[] = [];

  /** A queue the handler awaits and a test feeds; the client's abort ends it. */
  function openStream(req: WatchEventRequest, signal: AbortSignal): OpenStream {
    const queue: StreamItem[] = [];
    let waiting: ((item: StreamItem) => void) | undefined;
    const stream: OpenStream = {
      req,
      push(item) {
        if (waiting) {
          const resolve = waiting;
          waiting = undefined;
          resolve(item);
        } else {
          queue.push(item);
        }
      },
      next() {
        const item = queue.shift();
        if (item) {
          return Promise.resolve(item);
        }
        return new Promise((resolve) => {
          waiting = resolve;
        });
      },
      close() {
        const at = streams.indexOf(stream);
        if (at >= 0) {
          streams.splice(at, 1);
        }
        fake.openStreams = streams.map((s) => s.req);
      },
    };
    signal.addEventListener(
      "abort",
      () => stream.push({ kind: "end", error: undefined }),
      { once: true },
    );
    streams.push(stream);
    fake.openStreams = streams.map((s) => s.req);
    return stream;
  }

  function guard(behaviour: ListBehaviour, ctx: HandlerContext): void {
    if (behaviour === "unavailable") {
      throw new ConnectError("redeploying", Code.Unavailable);
    }
    if (!fake.honours(bearerOf(ctx))) {
      throw new ConnectError("not signed in", Code.Unauthenticated);
    }
    if (behaviour === "forbidden") {
      throw new ConnectError("not allowed", Code.PermissionDenied);
    }
  }

  function requireWriter(): void {
    if (!fake.user.admin && !fake.user.writeIncidents) {
      throw new ConnectError(
        "the requestor does not have EventWriteIncidents permission on this Event",
        Code.PermissionDenied,
      );
    }
  }

  /** The journal entries a write body carries, as the server would echo them. */
  function entriesOf(
    update: IncidentUpdate,
    now: ReturnType<typeof timestampFromDate>,
  ) {
    return update.journalEntries.map((e, i) =>
      create(JournalEntrySchema, {
        id: 1000 + fake.updateRequests.length * 10 + i,
        created: now,
        author: fake.user.handle,
        text: e.text,
        mentions: e.mentionedPersonIds.map((personId) => {
          const p = fake.people.find((person) => person.personId === personId);
          return { personId, handle: p?.handle, name: p?.name };
        }),
      }),
    );
  }

  /** Mirrors go/internal/incident/incident.go isJournalOnly. */
  function journalOnly(update: IncidentUpdate): boolean {
    const keys = Object.keys(toJson(IncidentUpdateSchema, update));
    return (
      update.journalEntries.length > 0 &&
      keys.length === 1 &&
      keys[0] === "journalEntries"
    );
  }

  /**
   * UpdateIncident's field writes, applied with the wire table's presence
   * semantics (plan 09y): state / priority UNSPECIFIED leave the field; the
   * optional scalars present = set, "" clears; outcomeId 0 clears; a present
   * location updates only its set pieces; the Int32List / IncidentRefList
   * wrappers present-but-empty clear; closed is stamped on the OPEN → CLOSED
   * transition and cleared on the reverse; lastModified is always bumped.
   */
  function applyFieldWrites(
    incident: Incident,
    update: IncidentUpdate,
    now: ReturnType<typeof timestampFromDate>,
  ): Incident {
    const next: MessageInitShape<typeof IncidentSchema> = { ...incident };
    if (
      update.state !== IncidentState.UNSPECIFIED &&
      update.state !== incident.state
    ) {
      next.state = update.state;
      next.closed = update.state === IncidentState.CLOSED ? now : undefined;
    }
    if (
      update.priority !== IncidentPriority.UNSPECIFIED &&
      update.priority !== incident.priority
    ) {
      next.priority = update.priority;
    }
    if (update.private !== undefined && update.private !== incident.private) {
      if (
        !fake.user.admin &&
        incident.createdBy?.personId !== fake.user.personId
      ) {
        throw new ConnectError(
          "only an admin or the incident's creator may change whether it is private",
          Code.PermissionDenied,
        );
      }
      next.private = update.private;
    }
    if (update.outcomeId !== undefined) {
      next.outcomeId = update.outcomeId === 0 ? undefined : update.outcomeId;
    }
    if (update.started !== undefined) {
      next.started = update.started;
    }
    if (update.summary !== undefined) {
      next.summary = update.summary === "" ? undefined : update.summary;
    }
    if (update.location !== undefined) {
      const loc = { ...(incident.location ?? {}) };
      if (update.location.areaSlug !== undefined) {
        loc.areaSlug =
          update.location.areaSlug === ""
            ? undefined
            : update.location.areaSlug;
      }
      if (update.location.description !== undefined) {
        loc.description =
          update.location.description === ""
            ? undefined
            : update.location.description;
      }
      if (update.location.booth !== undefined) {
        loc.booth =
          update.location.booth === "" ? undefined : update.location.booth;
      }
      next.location = create(IncidentLocationSchema, loc);
    }
    if (update.incidentTypeIds !== undefined) {
      next.incidentTypeIds = [...update.incidentTypeIds.values];
    }
    if (update.reports !== undefined) {
      next.reports = [...update.reports.values];
    }
    if (update.linkedIncidents !== undefined) {
      next.linkedIncidents = update.linkedIncidents.refs.map((r) => ({
        ...r,
        eventName:
          fake.events.find((e) => e.id === r.eventId)?.name ?? r.eventName,
        summary:
          fake.incidents.find(
            (v) =>
              v.incident?.eventId === r.eventId &&
              v.incident?.number === r.incidentNumber,
          )?.incident?.summary ?? "",
      }));
    }
    return create(IncidentSchema, { ...next, lastModified: now });
  }

  function issueAccessToken(): {
    token: string;
    expiresAt: ReturnType<typeof timestampFromDate>;
  } {
    counter += 1;
    const token = `access-${counter}`;
    const expiresAt = clock() + accessTtlMs;
    accessTokens.set(token, expiresAt);
    return { token, expiresAt: timestampFromDate(new Date(expiresAt)) };
  }

  function accessFor(eventId: number) {
    return create(AccessForEventSchema, {
      eventId,
      readIncidents: true,
      writeIncidents: fake.user.admin || fake.user.writeIncidents,
      writeReports:
        fake.user.admin || fake.user.writeIncidents || fake.user.writeReports,
      readAreas: fake.user.readAreas,
      attachFiles:
        fake.user.admin || fake.user.writeIncidents || fake.user.attachFiles,
      inviteReporters: fake.user.admin || fake.user.inviteReporters,
    });
  }

  /** The ceiling's top (53b): writer and crew leader are above an inviter. */
  function aboveCeiling(rung: ParticipationType): boolean {
    return (
      rung === ParticipationType.WRITER ||
      rung === ParticipationType.CREW_LEADER
    );
  }

  /** The wire's field gating: email / phone for an admin viewer or the caller's own row, is_admin and has_password admin-only, the event columns only with event_id. */
  function shapePerson(
    person: Person,
    view: { viewerId: number; admin: boolean; eventScoped: boolean },
  ): Person {
    const own = person.personId === view.viewerId;
    return create(PersonSchema, {
      ...person,
      email: view.admin || own ? person.email : undefined,
      phone: view.admin || own ? person.phone : undefined,
      isAdmin: view.admin ? person.isAdmin : false,
      // has_password, like is_admin, is populated for a personnel admin only.
      hasPassword: view.admin ? person.hasPassword : false,
      wristband: view.eventScoped ? person.wristband : undefined,
      participationType: view.eventScoped
        ? person.participationType
        : ParticipationType.UNSPECIFIED,
      crews: view.eventScoped ? person.crews : [],
    });
  }

  function record(method: string, ctx: HandlerContext): void {
    fake.calls.push({
      method,
      bearer: ctx.requestHeader.get("authorization"),
    });
  }

  function bearerOf(ctx: HandlerContext): string | undefined {
    const header = ctx.requestHeader.get("authorization");
    return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  }

  return fake;
}
