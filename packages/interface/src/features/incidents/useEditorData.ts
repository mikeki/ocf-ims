// SPDX-License-Identifier: Apache-2.0

import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import type { Outcome } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/outcome_pb";
import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import { useMemo } from "react";
import { useEventAccess, useEvents } from "@/features/events/hooks";
import {
  useAreas,
  useAttachedReports,
  useIncident,
  useIncidentTypes,
  useOutcomes,
} from "@/features/incidents/hooks";
import { isAdmin } from "@/lib/permissions";
import { useSession } from "@/session/provider";

// What the editor reads (plan 09y criterion 4): the incident, the lookups
// (areas, types, outcomes), the viewer's gates, and the attached reports'
// entries (decision 3: one GetReport per attached number, cached; a 404
// hides that report's entries), interleaved by time with a "Report #n"
// origin on each. Composes the existing hooks; adds no query key and no RPC
// beyond what useOutcomes / useAttachedReports already cover.

export interface JournalItem {
  entry: JournalEntry;
  /** Set when the entry came from an attached report. */
  report?: number;
}

export interface EditorGates {
  writeIncidents: boolean;
  attachFiles: boolean;
  mayAppend: boolean;
  /** An admin or the creator may toggle private. */
  mayTogglePrivate: boolean;
  me: number;
  author: string;
}

export interface EditorLookups {
  areas: Area[] | undefined;
  types: IncidentType[] | undefined;
  outcomes: Outcome[] | undefined;
  events: { id: number; name: string }[];
}

export interface EditorData {
  incidentQuery: ReturnType<typeof useIncident>;
  view: IncidentView | undefined;
  lookups: EditorLookups;
  gates: EditorGates;
  /** The incident's entries and the attached reports', by time. */
  journal: JournalItem[];
  /** Attached report numbers whose entries are (or would be) interleaved. */
  reportsLoaded: number[];
}

export function useEditorData(eventId: number, number: number): EditorData {
  const { state } = useSession();
  const access = useEventAccess(eventId);
  const incidentQuery = useIncident(eventId, number);
  const areasQuery = useAreas(eventId, access.readAreas);
  const typesQuery = useIncidentTypes();
  const outcomesQuery = useOutcomes();
  const eventsQuery = useEvents();
  const view = incidentQuery.data?.incident;
  const incident = view?.incident;

  const me = state.status === "signedIn" ? state.auth.personId : 0;
  const author = state.status === "signedIn" ? state.auth.user : "";
  const admin = state.status === "signedIn" && isAdmin(state.auth);

  const reportNumbers = incident?.reports ?? [];
  const reportQueries = useAttachedReports(eventId, reportNumbers);

  const journal = useMemo(() => {
    const items: JournalItem[] = (incident?.journalEntries ?? []).map(
      (entry) => ({ entry }),
    );
    reportQueries.forEach((q, i) => {
      const report = q.data?.report?.report;
      if (!report) {
        return;
      }
      for (const entry of report.journalEntries) {
        items.push({ entry, report: reportNumbers[i] });
      }
    });
    return items.sort((a, b) => timeOf(a.entry) - timeOf(b.entry));
  }, [incident, reportQueries, reportNumbers]);

  return {
    incidentQuery,
    view,
    lookups: {
      areas: areasQuery.data?.areas,
      types: typesQuery.data?.incidentTypes,
      outcomes: outcomesQuery.data?.outcomes,
      events: (eventsQuery.data?.events ?? []).map((e) => ({
        id: e.id,
        name: e.name ?? "",
      })),
    },
    gates: {
      writeIncidents: access.writeIncidents,
      attachFiles: access.attachFiles,
      mayAppend: view?.viewerMayAddJournal === true,
      mayTogglePrivate:
        access.writeIncidents &&
        (admin || incident?.createdBy?.personId === me),
      me,
      author,
    },
    journal,
    reportsLoaded: reportNumbers.filter((_, i) => reportQueries[i]?.data),
  };
}

function timeOf(entry: JournalEntry): number {
  const ts = entry.created;
  return ts ? Number(ts.seconds) * 1000 + ts.nanos / 1e6 : 0;
}
