// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import { MetricsSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/metrics_pb";
import { GetMetricsResponseSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/metrics_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import {
  buildEmptyMetrics,
  buildFairMetrics,
  changed,
  EMPTY_EVENT,
  FAIR_EVENT,
} from "@/prototypes/dashboard/data";
import type { FakeIms } from "@/test/fakeIms";

// Wraps createFakeIms() for the 3c.5 round (docs/plans/09ab-dashboard-design.md
// § The prototype round): the stock fake has no GetMetrics at all, so this
// registers it fresh, the way people/fake.ts adds ListMyCrews. GetAuthStatus
// needs no override — the stock route already keys writeIncidents off
// fake.user.writeIncidents/admin (src/test/fakeIms.ts's own accessFor), which
// is exactly the per-viewer switch this round needs.
//
// `router.rpc(method, impl)` replaces a single method's handler; a later
// registration wins over `fake.routes()`'s own `router.service()` call (see
// reports/fake.ts's header note, and people/fake.ts's copy of it).

function bearerOf(ctx: HandlerContext): string | undefined {
  const header = ctx.requestHeader.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

const FAIR_METRICS = buildFairMetrics();
const EMPTY_METRICS = buildEmptyMetrics();

export interface DashboardFake extends FakeIms {
  /** Applies `changed()` to exactly the next GetMetrics answer, then resets. */
  nextMetricsChanges: boolean;
  /** Fails exactly the next GetMetrics answer, then resets. */
  nextMetricsFails: boolean;
}

export function wrapDashboardFake(fake: FakeIms): DashboardFake {
  const extended = fake as DashboardFake;
  extended.nextMetricsChanges = false;
  extended.nextMetricsFails = false;

  const baseRoutes = fake.routes;
  fake.routes = (router: ConnectRouter) => {
    baseRoutes(router);

    router.rpc(ImsService.method.getMetrics, (req, ctx) => {
      fake.calls.push({ method: "GetMetrics", bearer: bearerOf(ctx) ?? null });
      if (!fake.honours(bearerOf(ctx))) {
        throw new ConnectError("not signed in", Code.Unauthenticated);
      }
      // The gate (§ Gating): event-wide write, never surfaced as a 403 — the
      // client checks access.writeIncidents before ever calling this, and
      // this mirrors that same rule for a caller that doesn't.
      if (!fake.user.admin && !fake.user.writeIncidents) {
        throw new ConnectError("not allowed", Code.PermissionDenied);
      }
      if (extended.nextMetricsFails) {
        extended.nextMetricsFails = false;
        throw new ConnectError(
          "the band forced this refresh to fail",
          Code.Unavailable,
        );
      }
      const base =
        req.eventId === EMPTY_EVENT.id ? EMPTY_METRICS : FAIR_METRICS;
      const source = extended.nextMetricsChanges ? changed(base) : base;
      extended.nextMetricsChanges = false;
      // generated_at bumps on every call (§ What to build 4) — even an
      // unchanged answer is freshly computed, so "Updated just now" is true.
      const metrics = create(MetricsSchema, {
        ...source,
        generatedAt: timestampFromDate(new Date()),
      });
      return create(GetMetricsResponseSchema, { metrics });
    });
  };
  return extended;
}

export { EMPTY_EVENT, FAIR_EVENT };
