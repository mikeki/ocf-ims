// SPDX-License-Identifier: Apache-2.0

import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { Lookups } from "@/features/dispatch/query";
import { saveStatePreference } from "@/features/dispatch/statePreference";
import { useDispatchQuery } from "@/features/dispatch/useDispatchQuery";
import { currentParams, resetFakeRouter } from "@/test/fakeRouter";
import { makeIncident, makeIncidentView } from "@/test/fixtures";

// A code review finding on 3c.1 (plan 09x): the stored state preference
// (criterion 6) leaked into the URL through any in-place patch, and an open
// drawer on a row the hub removed (finding 6) stuck in the URL forever.
// `DispatchScreen.test.tsx` covers the UI; this exercises the hook directly
// against `fakeRouter`, where the resulting URL params can be asserted on.

jest.mock("expo-router", () => require("@/test/fakeRouter"));

const lookups: Lookups = { types: [], areas: [] };

function row(number: number) {
  return makeIncidentView({ incident: makeIncident({ number }) });
}

beforeEach(async () => {
  resetFakeRouter();
  await AsyncStorage.clear();
});

describe("useDispatchQuery — the stored state preference (finding 1)", () => {
  it("a chip press overrides a stored non-open state, in the URL and in memory", async () => {
    await saveStatePreference(AsyncStorage, "closed");
    const rows = [row(214)];
    const { result } = await renderHook(() =>
      useDispatchQuery(rows, lookups, 1),
    );

    // The stored fallback applies once loaded: nothing in the URL, so the
    // resolved query starts out "closed".
    await waitFor(() => expect(result.current.query.state).toBe("closed"));

    await act(async () => {
      result.current.setState("open");
    });

    // Not a no-op: the resolved state actually flips to "open" and stays
    // there — a stale stored "closed" no longer wins the next parse.
    await waitFor(() => expect(result.current.query.state).toBe("open"));
    expect(currentParams().state).not.toBe("closed");
  });

  it("a bare open= link never gains a stored non-open state from the open⇒sel normalisation", async () => {
    resetFakeRouter({ open: "214" });
    await saveStatePreference(AsyncStorage, "closed");
    const rows = [row(214)];
    const { result } = await renderHook(() =>
      useDispatchQuery(rows, lookups, 1),
    );

    // The open⇒sel effect runs (sel catches up to open) ...
    await waitFor(() => expect(result.current.query.sel).toBe(214));
    // ... but it never wrote the stored "closed" into the URL along the way.
    expect(currentParams().state).toBeUndefined();
  });
});

describe("useDispatchQuery — a vanished open drawer (finding 6)", () => {
  it("clears open/sel in place once the rows have loaded without that row", async () => {
    resetFakeRouter({ open: "13" });
    const rows = [row(214)]; // no #13 — the hub removed it (a NotFound)
    const { result } = await renderHook(() =>
      useDispatchQuery(rows, lookups, 1, true),
    );

    await waitFor(() => {
      expect(result.current.query.open).toBeUndefined();
      expect(result.current.query.sel).toBeUndefined();
    });
    expect(currentParams().open).toBeUndefined();
    expect(currentParams().sel).toBeUndefined();
  });

  it("does not clear open/sel while the rows have not loaded yet", async () => {
    resetFakeRouter({ open: "13" });
    const { result } = await renderHook(() =>
      useDispatchQuery([], lookups, 1, false),
    );

    // Nothing to resolve #13 against yet — leave the URL alone rather than
    // guess that the row is gone.
    await waitFor(() => expect(result.current.query.sel).toBe(13));
    expect(result.current.query.open).toBe(13);
  });
});
