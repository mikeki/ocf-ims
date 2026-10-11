// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import type { JournalEntry } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { ReportSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import {
  ReportViewSchema,
  UpdateReportJournalEntryResponseSchema,
  UpdateReportResponseSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import type { FakeIms } from "@/test/fakeIms";

// Wraps createFakeIms() for the 3c.3 round (docs/plans/09z-reports-design.md
// § The prototype round): `ListReports` / `GetReport` stay the stock
// handlers — the harness sets `fake.reports` to exactly the viewer's visible
// set before building the runtime (Harness.tsx), so there is nothing left
// for the server side to scope. `UpdateReport` and `UpdateReportJournalEntry`
// are replaced: every write answers after 300ms, `UpdateReport` honours the
// plain-Report presence semantics with the round's two deliberate
// simplifications — the summary write always fails (Unavailable), so the
// failing-save case is always there to judge, and only the link write can
// append a system entry. `UpdateReportJournalEntry` (strike) has no stock
// handler at all (fakeIms.ts's header comment: "The client has never called
// it") — this is the first one.
//
// `router.rpc(method, impl)` replaces a single method's handler; the router's
// handler map is keyed by request path, so a later registration for the same
// path wins over the router.service() call `fake.routes()` makes first (see
// createUniversalHandlerClient in @connectrpc/connect).

const WRITE_DELAY_MS = 300;

let entryCounter = 9000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bearerOf(ctx: HandlerContext): string | undefined {
  const header = ctx.requestHeader.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

/** Mirrors fakeIms.ts's `requireReportWriter` — the write gate (§ Gating). */
function requireReportWriter(fake: FakeIms): void {
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

export function wrapReportsFake(fake: FakeIms): FakeIms {
  const baseRoutes = fake.routes;
  fake.routes = (router: ConnectRouter) => {
    baseRoutes(router);

    router.rpc(ImsService.method.updateReport, async (req, ctx) => {
      await delay(WRITE_DELAY_MS);
      fake.calls.push({
        method: "UpdateReport",
        bearer: bearerOf(ctx) ?? null,
      });
      if (!fake.honours(bearerOf(ctx))) {
        throw new ConnectError("not signed in", Code.Unauthenticated);
      }
      requireReportWriter(fake);
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
      // The one write configured to fail, always — so the failing-save case
      // (the field keeps its typed value, the error at the field) is never a
      // matter of timing to reach.
      if (write.summary !== undefined) {
        throw new ConnectError("redeploying", Code.Unavailable);
      }
      const report = view.report;
      const now = timestampFromDate(new Date());
      const appended: JournalEntry[] = [];
      // Presence semantics (§ One field, one request): absent leaves the
      // field; a report write only ever sets one of these two.
      let nextIncident = report.incident;

      if (write.incident !== undefined) {
        nextIncident = write.incident > 0 ? write.incident : undefined;
        if (
          nextIncident !== undefined &&
          !fake.incidents.some((v) => v.incident?.number === nextIncident)
        ) {
          throw new ConnectError("incident not found", Code.NotFound);
        }
        // A same-value link writes nothing (no system entry, no bump).
        if (nextIncident !== report.incident) {
          entryCounter += 1;
          appended.push(
            create(JournalEntrySchema, {
              id: entryCounter,
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

      if (write.journalEntries.length > 0) {
        for (const entry of write.journalEntries) {
          entryCounter += 1;
          appended.push(
            create(JournalEntrySchema, {
              id: entryCounter,
              created: now,
              author: fake.user.handle,
              text: entry.text,
              mentions: entry.mentions,
              onBehalfOf: entry.onBehalfOf,
            }),
          );
        }
      }

      const next = create(ReportSchema, {
        ...report,
        incident: nextIncident,
        journalEntries: [...report.journalEntries, ...appended],
      });
      fake.reports = fake.reports.map((v) =>
        v === view ? create(ReportViewSchema, { ...view, report: next }) : v,
      );
      return create(UpdateReportResponseSchema);
    });

    router.rpc(ImsService.method.updateReportJournalEntry, async (req, ctx) => {
      await delay(WRITE_DELAY_MS);
      fake.calls.push({
        method: "UpdateReportJournalEntry",
        bearer: bearerOf(ctx) ?? null,
      });
      if (!fake.honours(bearerOf(ctx))) {
        throw new ConnectError("not signed in", Code.Unauthenticated);
      }
      requireReportWriter(fake);
      const view = fake.reports.find(
        (v) => v.report?.number === req.reportNumber,
      );
      if (!view?.report) {
        throw new ConnectError("report not found", Code.NotFound);
      }
      const stricken = req.entry?.stricken === true;
      const next = create(ReportSchema, {
        ...view.report,
        journalEntries: view.report.journalEntries.map((e) =>
          e.id === req.journalEntryId
            ? create(JournalEntrySchema, { ...e, stricken })
            : e,
        ),
      });
      fake.reports = fake.reports.map((v) =>
        v === view ? create(ReportViewSchema, { ...view, report: next }) : v,
      );
      return create(UpdateReportJournalEntryResponseSchema);
    });
  };
  return fake;
}
