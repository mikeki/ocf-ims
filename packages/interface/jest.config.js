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
};
