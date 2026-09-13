// SPDX-License-Identifier: Apache-2.0

import { Code, ConnectError } from "@connectrpc/connect";
import { EventPokeKind } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/stream_pb";
import { backoffMs, STREAM_BACKOFF_MAX_MS, watchEvents } from "@/api/stream";
import { createFakeIms } from "@/test/fakeIms";
import { createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The stream loop (plan 09v) over the fake's WatchEvent through the real auth
// transport: the Bearer, the establishing beat, pokes, a drop and the resume
// with a gap, staleness, and the abort that ends it all.

const immediate = async () => undefined;

async function signedIn() {
  const fake = createFakeIms();
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return { fake, runtime };
}

function until(check: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) {
        resolve();
      } else if (Date.now() - start > ms) {
        reject(new Error("timed out"));
      } else {
        setTimeout(tick, 5);
      }
    };
    tick();
  });
}

describe("watchEvents", () => {
  it("opens with the Bearer, reports the open, and hands over pokes", async () => {
    const { fake, runtime } = await signedIn();
    const controller = new AbortController();
    const opens: boolean[] = [];
    const pokes: number[] = [];
    const done = watchEvents(
      runtime.client,
      { eventIds: [1], signal: controller.signal, sleep: immediate },
      {
        onOpen: (gap) => opens.push(gap),
        onPoke: (r) => {
          if (r.poke?.kind === EventPokeKind.INCIDENT_CHANGED) {
            pokes.push(r.poke.incidentNumber ?? -1);
          }
        },
      },
    );
    await until(() => opens.length === 1);
    expect(opens).toEqual([false]);
    expect(fake.callsOf("WatchEvent")[0]?.bearer).toMatch(/^Bearer /);
    expect(fake.openStreams[0]?.eventIds).toEqual([1]);
    fake.poke({ eventId: 1, incidentNumber: 12 });
    await until(() => pokes.length === 1);
    expect(pokes).toEqual([12]);
    controller.abort();
    await done;
    await until(() => fake.openStreams.length === 0);
  });

  it("reopens after a drop and says there was a gap", async () => {
    const { fake, runtime } = await signedIn();
    const controller = new AbortController();
    const opens: boolean[] = [];
    const drops: (string | undefined)[] = [];
    const done = watchEvents(
      runtime.client,
      { eventIds: [1], signal: controller.signal, sleep: immediate },
      {
        onOpen: (gap) => opens.push(gap),
        onPoke: () => undefined,
        onDrop: (err) =>
          drops.push(err?.code === undefined ? undefined : Code[err.code]),
      },
    );
    await until(() => opens.length === 1);
    fake.endStreams(new ConnectError("expired", Code.Unauthenticated));
    await until(() => opens.length === 2);
    expect(opens).toEqual([false, true]);
    expect(drops).toEqual(["Unauthenticated"]);
    fake.endStreams();
    await until(() => opens.length === 3);
    expect(drops[1]).toBeUndefined();
    controller.abort();
    await done;
  });

  it("declares a silent stream stale and reconnects", async () => {
    const { fake, runtime } = await signedIn();
    const controller = new AbortController();
    const opens: boolean[] = [];
    const done = watchEvents(
      runtime.client,
      {
        eventIds: [1],
        signal: controller.signal,
        sleep: immediate,
        staleMs: 30,
      },
      { onOpen: (gap) => opens.push(gap), onPoke: () => undefined },
    );
    await until(() => opens.length >= 2, 3000);
    expect(fake.callsOf("WatchEvent").length).toBeGreaterThanOrEqual(2);
    controller.abort();
    await done;
  });

  it("backs off with full jitter under the cap", () => {
    expect(backoffMs(0, () => 0)).toBe(1000);
    expect(backoffMs(0, () => 1)).toBeLessThanOrEqual(2000);
    expect(backoffMs(10, () => 1)).toBeLessThanOrEqual(STREAM_BACKOFF_MAX_MS);
    expect(backoffMs(3, () => 0.5)).toBe(4500);
  });
});
