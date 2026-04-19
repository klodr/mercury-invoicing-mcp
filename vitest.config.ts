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
      // index.ts is just stdio glue (env validation + StdioServerTransport
      // wiring); the actual server logic lives in server.ts.
      exclude: ["src/**/*.d.ts", "src/index.ts"],
    },
  },
});
