// Propagate package.json's `version` into the two other places that need it:
// server.json and src/server.ts. Run automatically by `npm version`.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const v = pkg.version;

// 1. server.json
const serverJsonPath = join(root, "server.json");
const server = JSON.parse(readFileSync(serverJsonPath, "utf8"));
server.version = v;
for (const p of server.packages ?? []) {
  if (p.identifier === pkg.name) p.version = v;
}
writeFileSync(serverJsonPath, JSON.stringify(server, null, 2) + "\n");

// 2. src/server.ts
const tsPath = join(root, "src", "server.ts");
const ts = readFileSync(tsPath, "utf8");
const re = /export const VERSION = "[^"]*";/;
if (!re.test(ts)) {
  console.error("sync-version: did not find VERSION literal in src/server.ts");
  process.exit(1);
}
const updatedTs = ts.replace(re, `export const VERSION = "${v}";`);
writeFileSync(tsPath, updatedTs);

console.log(`Synced version → ${v} (server.json, src/server.ts)`);
