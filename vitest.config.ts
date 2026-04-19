import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
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
