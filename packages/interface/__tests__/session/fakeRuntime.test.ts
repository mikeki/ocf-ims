// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { GetMetricsRequestSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/metrics_pb";
import { createFakeRuntimeDeps } from "@/session/fakeRuntime";
import { createRuntime } from "@/session/runtime";
import { FAIR_EVENT } from "@/test/metricsData";

// The EXPO_PUBLIC_FAKE_IMS=1 runtime (src/session/fakeRuntime.ts): a Runtime
// over the fake that signs in as the fake's user and answers the dashboard
// fixture for the one event — what a browser on the flag relies on.

describe("createFakeRuntimeDeps", () => {
  it("signs in as the fake's user and serves the fixture metrics for the event", async () => {
    const runtime = createRuntime({
      ...createFakeRuntimeDeps(),
      platform: "web",
    });
    await runtime.session.signIn("dee@example.org", "correct horse");
    expect(runtime.tokens.get()?.token).toBeTruthy();

    const events = await runtime.client.listEvents({});
    expect(events.events.map((e) => e.name)).toEqual([FAIR_EVENT.name]);

    const res = await runtime.client.getMetrics(
      create(GetMetricsRequestSchema, { eventId: FAIR_EVENT.id }),
    );
    expect(res.metrics?.total).toBeGreaterThan(0);
    expect(res.metrics?.byDay.length).toBeGreaterThan(0);
  });
});
