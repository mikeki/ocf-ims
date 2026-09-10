// SPDX-License-Identifier: Apache-2.0

// Registered as a jest.config.js setupFile: @react-native-async-storage's own
// in-memory mock, for anything that imports the real module directly
// (src/features/events/hooks.ts, src/session/appRuntime.ts) rather than
// taking it as an injected dependency.

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// TanStack Query's notifyManager defers each update notification by a real
// `setTimeout(fn, 0)`. With chained queries (useEventAccess gating useAreas)
// that notification can land after a test's last awaited assertion, outside
// any act() scope — an intermittent "not wrapped in act" warning. A
// synchronous scheduler is TanStack's own remedy for testing-library suites.
const { notifyManager } = require("@tanstack/react-query");
notifyManager.setScheduler((callback: () => void) => callback());
