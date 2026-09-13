// SPDX-License-Identifier: Apache-2.0

import { create, toJson } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import { AreaSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import {
  IncidentPersonSchema,
  IncidentPriority,
  IncidentSchema,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import { IncidentTypeSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { Notification } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/notification_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
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
import { ListEventsResponseSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/event_pb";
import type { RequestReportRequest } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import {
  CreateIncidentResponseSchema,
  GetIncidentResponseSchema,
  type IncidentUpdate,
  IncidentUpdateSchema,
  type IncidentView,
  IncidentViewSchema,
  ListIncidentsResponseSchema,
  RequestReportResponseSchema,
  type UpdateIncidentRequest,
  UpdateIncidentResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import {
  ListIncidentTypesResponseSchema,
  ProposeIncidentTypeResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_type_pb";
import {
  ListNotificationsResponseSchema,
  MarkAllNotificationsReadResponseSchema,
  MarkNotificationReadResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/notification_pb";
import { ListPersonnelResponseSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/person_pb";
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
    proposeIncidentType: ListBehaviour;
    createArea: ListBehaviour;
    createReport: ListBehaviour;
    updateReport: ListBehaviour;
    requestReport: ListBehaviour;
    listNotifications: ListBehaviour;
    markNotificationRead: ListBehaviour;
    markAllNotificationsRead: ListBehaviour;
    registerPushDevice: ListBehaviour;
    unregisterPushDevice: ListBehaviour;
    watchEvent: ListBehaviour;
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
  /** Programmable ListPersonnel{query} data (09r); the typeahead matches handle and name. */
  people: Person[];
  /** Every UpdateIncident request received, for wire-shape assertions (09r). */
  updateRequests: UpdateIncidentRequest[];
  /** Every UpdateReport request received (09t). */
  updateReportRequests: UpdateReportRequest[];
  /** Every RequestReport request received (09t). */
  requestReportRequests: RequestReportRequest[];
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
      ...options.user,
    },
    events: [{ id: 1, name: "2026" }],
    incidents: [],
    reports: [],
    areas: [],
    incidentTypes: [],
    people: [],
    updateRequests: [],
    updateReportRequests: [],
    requestReportRequests: [],
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
          guard(fake.behaviour.listPersonnel, ctx);
          // The server's typeahead answers nothing below two characters.
          const q = (req.query ?? "").trim().toLowerCase();
          if (q.length < 2) {
            return create(ListPersonnelResponseSchema, { people: [] });
          }
          return create(ListPersonnelResponseSchema, {
            people: fake.people.filter(
              (p) =>
                (p.handle ?? "").toLowerCase().includes(q) ||
                (p.name ?? "").toLowerCase().includes(q),
            ),
          });
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
          const next = create(IncidentViewSchema, {
            ...view,
            incident: create(IncidentSchema, {
              ...incident,
              lastModified: now,
              journalEntries: [
                ...incident.journalEntries,
                ...entriesOf(update, now),
              ],
            }),
          });
          fake.incidents = fake.incidents.map((v) => (v === view ? next : v));
          return create(UpdateIncidentResponseSchema);
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
          guard(fake.behaviour.updateReport, ctx);
          requireReportWriter();
          fake.updateReportRequests.push(req);
          const view = fake.reports.find(
            (v) => v.report?.number === req.reportNumber,
          );
          if (!view?.report) {
            throw new ConnectError("report not found", Code.NotFound);
          }
          const write = req.report;
          if (!write) {
            throw new ConnectError("report is required", Code.InvalidArgument);
          }
          const linked = linkedIncident(req.eventId, write.incident);
          const now = timestampFromDate(new Date(clock()));
          const report = view.report;
          const next = create(ReportViewSchema, {
            ...view,
            report: create(ReportSchema, {
              ...report,
              ...(write.summary !== undefined
                ? { summary: write.summary }
                : {}),
              ...(write.incident !== undefined
                ? { incident: write.incident > 0 ? write.incident : undefined }
                : {}),
              journalEntries: [
                ...report.journalEntries,
                ...reportEntriesOf(write, now),
              ],
            }),
          });
          fake.reports = fake.reports.map((v) => (v === view ? next : v));
          if (linked) {
            markDelivered(linked, req.reportNumber);
          }
          return create(UpdateReportResponseSchema);
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
