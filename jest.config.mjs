/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          module: "ESNext",
          target: "ES2022",
          types: ["node", "jest"],
          esModuleInterop: true,
        },
      },
    ],
  },
  testMatch: ["**/test/**/*.test.ts"],
  // Auto-restore any jest.spyOn/jest.fn between tests, even if an
  // assertion throws — prevents spies from leaking and silencing
  // console output in subsequent tests.
  restoreMocks: true,
  setupFiles: ["<rootDir>/test/setup.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    // index.ts is just 22 lines of stdio glue (env validation + StdioServerTransport
    // wiring). The actual server construction logic is in server.ts (tested at 96%+).
    "!src/index.ts",
  ],
  coverageDirectory: "coverage",
};
