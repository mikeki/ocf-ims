module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/e2e/"],
  // The `@/` alias from tsconfig.json (Metro reads tsconfig paths; Jest does not).
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
