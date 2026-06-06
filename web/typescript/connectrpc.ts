//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

// Minimal, hand-written client for the proto-first Connect IncidentService. It
// speaks the Connect protocol over JSON via the existing fetch/JWT plumbing
// (ims.fetchNoThrow), so it needs no new browser dependencies or bundler.
//
// This is intentionally hand-typed rather than generated: the repo has no JS/TS
// proto-codegen (protoc-gen-es) or bundler toolchain yet. When that lands, the
// interfaces and calls below can be replaced wholesale by protoc-gen-es +
// @connectrpc/connect-web output. See docs/plans/07-proto-integration.md.
//
// The shapes follow the proto3 JSON mapping that connect-go emits:
//   - field names are lowerCamelCase
//   - enums are their string names ("INCIDENT_STATE_NEW", ...)
//   - timestamps are RFC3339 strings; int64 (personId) is a string
//   - default/empty/zero-valued fields are omitted, so most fields are optional

import * as ims from "./ims.ts";

// Base path of the Connect service; individual procedures are appended, e.g.
// `${connectServiceBase}/ListIncidents`.
const connectServiceBase = "/ocf.ims.v1.IncidentService";

export type IncidentState =
    | "INCIDENT_STATE_UNSPECIFIED"
    | "INCIDENT_STATE_NEW"
    | "INCIDENT_STATE_ON_HOLD"
    | "INCIDENT_STATE_DISPATCHED"
    | "INCIDENT_STATE_ON_SCENE"
    | "INCIDENT_STATE_CLOSED";

export type IncidentPriority =
    | "INCIDENT_PRIORITY_UNSPECIFIED"
    | "INCIDENT_PRIORITY_LOW"
    | "INCIDENT_PRIORITY_NORMAL"
    | "INCIDENT_PRIORITY_HIGH";

export interface Location {
    name?: string;
    address?: string;
    description?: string;
}

export interface PersonInvolvement {
    personId?: string; // int64 is encoded as a string in proto3 JSON
    nickname?: string;
    involvement?: string;
}

export interface Attachment {
    name?: string;
    previewable?: boolean;
}

export interface ReportEntry {
    id?: number;
    created?: string;
    authorNickname?: string;
    systemEntry?: boolean;
    text?: string;
    stricken?: boolean;
    attachment?: Attachment;
}

export interface LinkedIncident {
    event?: string;
    eventId?: number;
    number?: number;
    summary?: string;
}

export interface Incident {
    event?: string;
    eventId?: number;
    number?: number;
    created?: string;
    lastModified?: string;
    state?: IncidentState;
    started?: string;
    closed?: string;
    priority?: IncidentPriority;
    summary?: string;
    location?: Location;
    incidentTypeIds?: number[];
    reports?: number[];
    visits?: number[];
    peopleInvolved?: PersonInvolvement[];
    linkedIncidents?: LinkedIncident[];
    reportEntries?: ReportEntry[];
}

export interface ListIncidentsRequest {
    event: string;
}

export interface ListIncidentsResponse {
    incidents?: Incident[];
}

export interface GetIncidentRequest {
    event: string;
    number: number;
}

export interface GetIncidentResponse {
    incident?: Incident;
}

// connectUnary issues a Connect-protocol unary call over JSON. For a unary RPC
// the Connect protocol is a plain POST to the procedure URL with a JSON body;
// connect-go replies with a JSON-encoded message (HTTP 200) or a JSON error
// envelope (non-2xx). ims.fetchNoThrow handles auth (Bearer JWT) and JSON.
async function connectUnary<Req, Resp>(procedure: string, req: Req): Promise<ims.FetchRes<Resp>> {
    return ims.fetchNoThrow<Resp>(`${connectServiceBase}/${procedure}`, {
        method: "POST",
        body: JSON.stringify(req),
        headers: {
            "Content-Type": "application/json",
            // Recommended by the Connect protocol; connect-go doesn't require it
            // by default, but sending it is harmless and forward-looking.
            "Connect-Protocol-Version": "1",
        },
    });
}

export async function listIncidents(event: string): Promise<ims.FetchRes<ListIncidentsResponse>> {
    return connectUnary<ListIncidentsRequest, ListIncidentsResponse>("ListIncidents", {event});
}

export async function getIncident(event: string, number: number): Promise<ims.FetchRes<GetIncidentResponse>> {
    return connectUnary<GetIncidentRequest, GetIncidentResponse>("GetIncident", {event, number});
}
