// SPDX-License-Identifier: Apache-2.0

import { act, renderHook } from "@testing-library/react-native";
import { useMinuteClock } from "@/features/dispatch/useMinuteClock";

// `now` was frozen at mount before this (plan 09x finding 7): a minute
// ticker instead, shared by `useDispatchQuery` and `IncidentPage`.

describe("useMinuteClock", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("ticks once a minute", async () => {
    const start = Date.now();
    const { result } = await renderHook(() => useMinuteClock());
    expect(result.current).toBe(start);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current).toBeGreaterThan(start);
  });

  it("does not tick before a minute has passed", async () => {
    const start = Date.now();
    const { result } = await renderHook(() => useMinuteClock());

    await act(async () => {
      jest.advanceTimersByTime(59_000);
    });
    expect(result.current).toBe(start);
  });

  it("clears its interval on unmount, so Jest reports no open handles", async () => {
    const cleared = jest.spyOn(global, "clearInterval");
    const { unmount } = await renderHook(() => useMinuteClock());
    await unmount();
    expect(cleared).toHaveBeenCalled();
  });
});
