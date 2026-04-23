import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
    // Keep the default human-readable reporter and ALSO emit a JUnit XML
    // file for Codecov Test Analytics (flaky / slow test detection over
    // time). Regenerated every run; gitignored.
    reporters: ["default", ["junit", { outputFile: "test-results.junit.xml" }]],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // index.ts is the stdio entry point; testing it requires process/stdio
      // mocking that adds complexity disproportionate to its coverage value.
      // The actual server logic lives in server.ts.
      exclude: ["src/**/*.d.ts", "src/index.ts"],
    },
  },
});
