// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ApiProvider } from "@/api/providers";
import { ThemeProvider } from "@/design/theme";
import { useMetrics } from "@/features/dashboard/useMetrics";
import { SessionProvider } from "@/session/provider";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { makeMetrics } from "@/test/fixtures";
import { createTestQueryClient, createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// useMetrics (plan 09ab, builder 1): one GetMetrics polled at the preference's
// interval, the previous frame kept across a failed refetch, and the changed
// keys between the last two successful answers.

async function setup(fake: FakeIms, intervalMs: number | false) {
  const runtime = createTestRuntime({
    fake,
    store: createMemoryRefreshTokenStore(fake.issueRefreshToken()),
  });
  await runtime.session.bootstrap();
  const queryClient = createTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider scheme="light">
      <ApiProvider transport={runtime.transport} queryClient={queryClient}>
        <SessionProvider session={runtime.session}>{children}</SessionProvider>
      </ApiProvider>
    </ThemeProvider>
  );
  return renderHook(() => useMetrics(1, intervalMs), { wrapper: Wrapper });
}

function writerFake(): FakeIms {
  const fake = createFakeIms({ user: { writeIncidents: true } });
  fake.metrics[1] = makeMetrics();
  return fake;
}

afterEach(() => {
  jest.useRealTimers();
});

describe("useMetrics — the interval", () => {
  it("polls at the interval when it is on", async () => {
    jest.useFakeTimers();
    const fake = writerFake();
    const { result } = await setup(fake, 30_000);
    await waitFor(() => expect(result.current.metrics).toBeDefined());
    expect(fake.getMetricsRequests).toHaveLength(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(fake.getMetricsRequests).toHaveLength(2));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(fake.getMetricsRequests).toHaveLength(3));
  });

  it("never polls when it is off", async () => {
    jest.useFakeTimers();
    const fake = writerFake();
    const { result } = await setup(fake, false);
    await waitFor(() => expect(result.current.metrics).toBeDefined());

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(fake.getMetricsRequests).toHaveLength(1);
  });

  it("refresh() refetches", async () => {
    const fake = writerFake();
    const { result } = await setup(fake, false);
    await waitFor(() => expect(result.current.metrics).toBeDefined());

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(fake.getMetricsRequests).toHaveLength(2));
  });
});

describe("useMetrics — changedKeys", () => {
  it("names the cards that moved between two answers, then clears after 60 s", async () => {
    jest.useFakeTimers();
    const fake = writerFake();
    const { result } = await setup(fake, false);
    await waitFor(() => expect(result.current.metrics).toBeDefined());
    expect(result.current.changedKeys.size).toBe(0);

    const base = fake.metrics[1];
    fake.metrics[1] = makeMetrics({
      open: (base?.open ?? 0n) + 1n,
      byDay: base?.byDay.map((d, i, all) =>
        i === all.length - 1 ? { ...d, count: d.count + 1n } : d,
      ),
    });
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.changedKeys.size).toBe(2));
    expect(result.current.changedKeys.has("open")).toBe(true);
    expect(result.current.changedKeys.has("day")).toBe(true);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(59_000);
    });
    expect(result.current.changedKeys.size).toBe(2);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.changedKeys.size).toBe(0);
  });

  it("clears on the next successful answer even when nothing moved", async () => {
    const fake = writerFake();
    const { result } = await setup(fake, false);
    await waitFor(() => expect(result.current.metrics).toBeDefined());

    fake.metrics[1] = makeMetrics({ total: 181n });
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() =>
      expect(result.current.changedKeys.has("total")).toBe(true),
    );

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.changedKeys.size).toBe(0));
  });
});

describe("useMetrics — a failed refetch", () => {
  it("keeps the data and sets lastError, which the next success clears", async () => {
    const fake = writerFake();
    const { result } = await setup(fake, false);
    await waitFor(() => expect(result.current.metrics).toBeDefined());
    const held = result.current.metrics;

    fake.behaviour.getMetrics = "unavailable";
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.lastError).toBeDefined());
    expect(result.current.lastError?.kind).toBe("unavailable");
    expect(result.current.metrics).toBe(held);
    expect(result.current.error).toBeUndefined();

    fake.behaviour.getMetrics = "ok";
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.lastError).toBeUndefined());
    expect(result.current.metrics).toBeDefined();
  });

  it("reports a first-load failure as error, not lastError", async () => {
    const fake = writerFake();
    fake.behaviour.getMetrics = "unavailable";
    const { result } = await setup(fake, false);
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.lastError).toBeUndefined();
    expect(result.current.metrics).toBeUndefined();
  });
});
