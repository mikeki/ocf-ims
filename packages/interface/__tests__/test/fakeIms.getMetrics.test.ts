// SPDX-License-Identifier: Apache-2.0

import { createFakeIms, type FakeIms, type FakeUser } from "@/test/fakeIms";
import { makeMetrics } from "@/test/fixtures";
import { createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The fake's GetMetrics (plan 09ab, builder 1): a Metrics per event id, the
// empty aggregate for an event with none, the writer gate, the behaviours,
// the request log and a generated_at from the fake's clock.

async function clientFor(fake: FakeIms, clock?: () => number) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, clock });
  await runtime.session.bootstrap();
  return runtime.client;
}

function fakeFor(user: Partial<FakeUser>, clock?: () => number): FakeIms {
  return createFakeIms({ user: { personId: 42, ...user }, clock });
}

describe("fakeIms — GetMetrics", () => {
  it("answers fake.metrics for the event and logs the request", async () => {
    const fake = fakeFor({ writeIncidents: true });
    fake.metrics[1] = makeMetrics();
    const client = await clientFor(fake);
    const { metrics } = await client.getMetrics({ eventId: 1 });
    expect(metrics?.total).toBe(180n);
    expect(metrics?.byDay).toHaveLength(8);
    expect(fake.getMetricsRequests.map((r) => r.eventId)).toEqual([1]);
    expect(fake.callsOf("GetMetrics")).toHaveLength(1);
  });

  it("answers the empty aggregate for an event with none", async () => {
    const fake = fakeFor({ writeIncidents: true });
    const client = await clientFor(fake);
    const { metrics } = await client.getMetrics({ eventId: 9 });
    expect(metrics?.total).toBe(0n);
    expect(metrics?.byArea).toEqual([]);
    expect(metrics?.openFollowUps).toEqual([]);
    expect(metrics?.avgTimeToCloseSeconds).toBeUndefined();
  });

  it("stamps generated_at from the fake's clock on each answer", async () => {
    let now = Date.parse("2026-07-10T12:00:00Z");
    const fake = fakeFor({ admin: true }, () => now);
    fake.metrics[1] = makeMetrics();
    const client = await clientFor(fake, () => now);
    const first = await client.getMetrics({ eventId: 1 });
    now += 90_000;
    const second = await client.getMetrics({ eventId: 1 });
    expect(Number(first.metrics?.generatedAt?.seconds)).toBe(
      Date.parse("2026-07-10T12:00:00Z") / 1000,
    );
    expect(Number(second.metrics?.generatedAt?.seconds)).toBe(
      Date.parse("2026-07-10T12:01:30Z") / 1000,
    );
  });

  it("refuses a caller who cannot write incidents", async () => {
    const client = await clientFor(fakeFor({ writeIncidents: false }));
    await expect(client.getMetrics({ eventId: 1 })).rejects.toMatchObject({
      code: 7,
    });
  });

  it("honours the forbidden and unavailable behaviours", async () => {
    const fake = fakeFor({ writeIncidents: true });
    const client = await clientFor(fake);
    fake.behaviour.getMetrics = "forbidden";
    await expect(client.getMetrics({ eventId: 1 })).rejects.toMatchObject({
      code: 7,
    });
    fake.behaviour.getMetrics = "unavailable";
    await expect(client.getMetrics({ eventId: 1 })).rejects.toMatchObject({
      code: 14,
    });
    expect(fake.getMetricsRequests).toHaveLength(2);
  });
});

describe("makeMetrics", () => {
  it("converts a plain openFollowUps override into messages", () => {
    const metrics = makeMetrics({
      openFollowUps: [{ incidentNumber: 7, summary: "Lost child" }],
    });
    expect(metrics.openFollowUps).toHaveLength(1);
    expect(metrics.openFollowUps[0]?.$typeName).toBe(
      "ocf.ims.resources.v1.MetricIncidentRef",
    );
    expect(metrics.openFollowUps[0]?.incidentNumber).toBe(7);
  });
});
