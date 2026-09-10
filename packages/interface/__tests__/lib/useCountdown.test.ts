// SPDX-License-Identifier: Apache-2.0

import { act, renderHook } from "@testing-library/react-native";
import { useCountdown } from "@/lib/useCountdown";

describe("useCountdown", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("counts down from the given seconds to zero, one second at a time", async () => {
    const { result } = await renderHook(() => useCountdown(3));
    expect(result.current).toBe(3);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(2);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(0);

    // Stays at 0 — the interval is cleared once it gets there.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(0);
  });

  it("answers 0 and does not start a timer when seconds is undefined", async () => {
    const { result } = await renderHook(() => useCountdown(undefined));
    expect(result.current).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(0);
  });

  it("restarts from a new value", async () => {
    const { result, rerender } = await renderHook(
      ({ seconds }: { seconds: number | undefined }) => useCountdown(seconds),
      { initialProps: { seconds: 2 } },
    );
    expect(result.current).toBe(2);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(0);

    await rerender({ seconds: 5 });
    expect(result.current).toBe(5);
  });
});
