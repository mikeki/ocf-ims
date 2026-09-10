// SPDX-License-Identifier: Apache-2.0

// Registered as a jest.config.js setupFile: @react-native-async-storage's own
// in-memory mock, for anything that imports the real module directly
// (src/features/events/hooks.ts, src/session/appRuntime.ts) rather than
// taking it as an injected dependency.

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
