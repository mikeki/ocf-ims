// SPDX-License-Identifier: Apache-2.0

import type { ReportView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import type { RefObject } from "react";
import type { useEditReport } from "@/prototypes/reports/useEditReport";

// Shared types for the 3c.3 report-pane round (docs/plans/09z-reports-design.md
// § The prototype round). One file so the harness, the table and the three
// variants agree on the same shapes without a barrel file.

/**
 * The four viewers the round's harness switches between (§ The prototype
 * round): dispatcher (write-all reports + write incidents), reporter
 * (own-only read+write), crew leader (crew reads, no write bit), admin.
 * Nothing on the wire says which rule admitted a report to the viewer's
 * table — the fixtures per viewer stand in for the server's scoping.
 */
export type Viewer = "dispatcher" | "reporter" | "crewLeader" | "admin";

/**
 * What the keyboard map's `a` / `h` reach into a variant, mirroring
 * `IncidentScreenHandle` (plan 09y). Optional on every variant: the stub
 * panes never call `useImperativeHandle`, so both bindings are harmless
 * no-ops until a variant wires them.
 */
export interface ReportPaneHandle {
  focusComposer(): void;
  toggleSystemEntries(): void;
}

/**
 * The props every variant (Ledger / Account / Companion) renders from — the
 * "§ The prototype round" prompt's list, plus the optional `handle` the
 * keyboard map needs (the round's own addition; the pick's variant can leave
 * it unwired until it grows a composer).
 */
export interface ReportPaneProps {
  view: ReportView;
  eventId: number;
  edit: ReturnType<typeof useEditReport>;
  viewer: Viewer;
  onOpenIncident: (number: number) => void;
  onCreateIncident: () => void;
  handle?: RefObject<ReportPaneHandle | null>;
}
