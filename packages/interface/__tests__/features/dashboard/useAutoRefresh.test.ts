// SPDX-License-Identifier: Apache-2.0

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  AUTO_REFRESH_KEY,
  intervalMsFor,
  loadAutoRefresh,
  saveAutoRefresh,
  useAutoRefresh,
} from "@/features/dashboard/useAutoRefresh";
import { createMemoryAsyncStorage } from "@/test/storage";

// The dashboard's auto-refresh preference (plan 09ab): Off · 30 s · 1 min ·
// 5 min, default Off, every storage read and write in try/catch.

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe("auto-refresh preference", () => {
  it("defaults to Off, with no polling interval", async () => {
    const { result } = await renderHook(() => useAutoRefresh());
    expect(result.current.preference).toBe("off");
    expect(result.current.intervalMs).toBe(false);
  });

  it("maps each choice to its interval", () => {
    expect(intervalMsFor("off")).toBe(false);
    expect(intervalMsFor("30s")).toBe(30_000);
    expect(intervalMsFor("1m")).toBe(60_000);
    expect(intervalMsFor("5m")).toBe(300_000);
  });

  it("persists a choice under ocf-ims/dashboard/autoRefresh and reads it back", async () => {
    const first = await renderHook(() => useAutoRefresh());
    await act(async () => {
      first.result.current.setPreference("1m");
    });
    expect(first.result.current.intervalMs).toBe(60_000);
    await waitFor(async () =>
      expect(await AsyncStorage.getItem("ocf-ims/dashboard/autoRefresh")).toBe(
        "1m",
      ),
    );
    expect(AUTO_REFRESH_KEY).toBe("ocf-ims/dashboard/autoRefresh");

    const second = await renderHook(() => useAutoRefresh());
    await waitFor(() => expect(second.result.current.preference).toBe("1m"));
  });

  it("falls back to Off for an unreadable stored value", async () => {
    const storage = createMemoryAsyncStorage();
    storage.items.set(AUTO_REFRESH_KEY, "sideways");
    expect(await loadAutoRefresh(storage)).toBe("off");
  });

  it("keeps a choice made before the stored preference has loaded", async () => {
    let release: (v: string | null) => void = () => undefined;
    jest.spyOn(AsyncStorage, "getItem").mockReturnValue(
      new Promise<string | null>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = await renderHook(() => useAutoRefresh());
    await act(async () => {
      result.current.setPreference("30s");
    });
    await act(async () => {
      release("5m");
    });
    expect(result.current.preference).toBe("30s");
  });

  it("survives storage that throws on read and on write", async () => {
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValue(new Error("storage is gone"));
    jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValue(new Error("storage is gone"));

    const { result } = await renderHook(() => useAutoRefresh());
    expect(result.current.preference).toBe("off");
    await act(async () => {
      result.current.setPreference("5m");
    });
    expect(result.current.preference).toBe("5m");

    const throwing = {
      getItem: () => {
        throw new Error("sync throw");
      },
      setItem: () => {
        throw new Error("sync throw");
      },
      removeItem: () => Promise.resolve(),
    };
    expect(await loadAutoRefresh(throwing)).toBe("off");
    await expect(saveAutoRefresh(throwing, "30s")).resolves.toBeUndefined();
  });
});
