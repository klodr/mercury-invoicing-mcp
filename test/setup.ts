import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MERCURY_MCP_STATE_DIR = mkdtempSync(join(tmpdir(), "mercury-mcp-state-"));
