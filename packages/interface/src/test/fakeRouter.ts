// SPDX-License-Identifier: Apache-2.0

import { useEffect, useSyncExternalStore } from "react";

// A minimal expo-router stand-in for Jest screen tests whose state lives in
// the URL (plan 09x: the dispatch table's whole state is the query string).
// Registered per test file with:
//
//   jest.mock("expo-router", () => require("@/test/fakeRouter"));
//
// `expo-router/testing-library`'s `renderRouter` was tried first and
// rejected: its own `mocks.js` unconditionally `jest.mock`s
// react-native-reanimated to a stub lacking `cubicBezier`, which breaks
// every real press/fade animation this app ships (`src/design/motion.tsx`)
// — a genuine conflict with jest.config.js's deliberate choice to run the
// real Reanimated so CSS-transition motion can be exercised. This fakes only
// the three hooks the dispatch code actually calls (`useRouter`,
// `useLocalSearchParams`, `useFocusEffect`), so the real motion system, and
// every other screen's real `expo-router`-free hooks, are untouched.

export type FakeRouterParams = Record<string, string | undefined>;

let params: FakeRouterParams = {};
const listeners = new Set<() => void>();
export const pushed: unknown[] = [];

/** Call in `beforeEach`: a fresh URL and an empty push log for the next test. */
export function resetFakeRouter(initial: FakeRouterParams = {}): void {
  params = { ...initial };
  pushed.length = 0;
  for (const listener of listeners) {
    listener();
  }
}

function getParams(): FakeRouterParams {
  return params;
}

/** The URL's current params, for asserting what a `setParams` call did. */
export function currentParams(): FakeRouterParams {
  return { ...params };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRouter() {
  return {
    push: (href: unknown) => {
      pushed.push(href);
    },
    setParams: (patch: FakeRouterParams) => {
      params = { ...params, ...patch };
      for (const listener of listeners) {
        listener();
      }
    },
    back: () => undefined,
    canGoBack: () => false,
  };
}

export function useLocalSearchParams(): FakeRouterParams {
  return useSyncExternalStore(subscribe, getParams, getParams);
}

/** Every screen in a unit test is the only, always-focused one. */
export function useFocusEffect(effect: () => undefined | (() => void)): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount/unmount only, like the real hook's focus/blur.
  useEffect(effect, []);
}
