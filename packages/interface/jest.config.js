module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/e2e/"],
  // The `@/` alias from tsconfig.json (Metro reads tsconfig paths; Jest does not).
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // AsyncStorage has no native module in Jest; mock it with the library's own
  // in-memory implementation (src/features/events/hooks.ts and
  // src/session/appRuntime.ts import the real module directly).
  setupFiles: ["<rootDir>/jest.setup.ts"],
  // The first test in a screen suite pays the suite's cold transform cost
  // (jest-expo, react-native, the generated protos); on the CI runner that
  // took a whole screen render past Jest's 5 s default (PR #246).
  testTimeout: 20_000,
};
