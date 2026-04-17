import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
  banner: { js: "#!/usr/bin/env node" }
});
