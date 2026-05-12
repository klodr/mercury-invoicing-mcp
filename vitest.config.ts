import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Test discovery covers the canonical `test/` tree plus
    // `scripts/**/*.test.mjs` so the tempdir-driven sync-version unit
    // test runs alongside the rest of the suite.
    include: ["test/**/*.test.ts", "scripts/**/*.test.mjs"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
    // Keep the default human-readable reporter and ALSO emit a JUnit XML
    // file for Codecov Test Analytics (flaky / slow test detection over
    // time). Regenerated every run; gitignored.
    reporters: ["default", ["junit", { outputFile: "test-results.junit.xml" }]],
    coverage: {
      provider: "v8",
      // `lcov` for codecov-action's primary upload; `json` (v8 native)
      // carries per-branch hit counts so codecov can compute accurate
      // indirect-changes — without it codecov falls back to a coarser
      // line-based delta and reports phantom regressions on files the
      // PR doesn't touch. `text` keeps the human-readable summary in
      // CI logs.
      reporter: ["text", "lcov", "json"],
      include: ["src/**/*.ts", "scripts/**/*.mjs"],
      // `src/index.ts` is the stdio CLI entry point — a thin shim that
      // boots `StdioServerTransport`. Testing it requires booting a real
      // transport, which deadlocks the test runner waiting for the next
      // stdio frame. The orchestration the shim wraps lives in
      // `server.ts` and is covered there.
      //
      // `scripts/**/*.test.mjs` is the test file, not the unit under
      // test, so excluded from coverage measurement.
      //
      // `scripts/prod-readonly-test.mjs` and `scripts/sandbox-test.mjs`
      // are top-level smoke tests that spawn `dist/index.js` against
      // sandbox / read-only credentials; not unit tests, not subjects
      // of coverage.
      exclude: [
        "src/index.ts",
        "scripts/**/*.test.mjs",
        "scripts/prod-readonly-test.mjs",
        "scripts/sandbox-test.mjs",
      ],
    },
  },
});
