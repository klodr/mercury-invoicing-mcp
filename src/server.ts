import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";

// Kept in sync with package.json by scripts/sync-version.mjs (called by the
// `npm version` lifecycle hook). Do not edit manually — bump via
// `npm version patch|minor|major`.
export const VERSION = "0.7.4";
export const SANDBOX_BASE_URL = "https://api-sandbox.mercury.com/api/v1";

export interface ServerOptions {
  apiKey: string;
  /** Override the Mercury API base URL (e.g. for a self-hosted proxy). */
  baseUrl?: string;
  /** Custom logger for sandbox detection / startup messages. Defaults to console.error. */
  log?: (msg: string) => void;
}

/**
 * Resolve the Mercury API base URL from the API key + an optional explicit
 * override. Sandbox tokens (containing "mercury_sandbox_") are auto-detected.
 */
export function resolveBaseUrl(apiKey: string, explicitBaseUrl?: string): string | undefined {
  if (explicitBaseUrl) return explicitBaseUrl;
  // Strict prefix match so a token like "mercury_production_with_word_sandbox_in_it"
  // is not accidentally routed to sandbox.
  if (apiKey.startsWith("secret-token:mercury_sandbox_")) return SANDBOX_BASE_URL;
  return undefined;
}

/**
 * Build a fully wired MCP server: Mercury client + middleware-wrapped tools.
 * Does NOT connect to any transport — the caller decides (stdio for production,
 * InMemoryTransport for tests).
 */
export function createServer(opts: ServerOptions): McpServer {
  const log = opts.log ?? ((msg: string) => console.error(msg));

  const baseUrl = resolveBaseUrl(opts.apiKey, opts.baseUrl);
  if (baseUrl === SANDBOX_BASE_URL && !opts.baseUrl) {
    log("Detected sandbox token → using https://api-sandbox.mercury.com/api/v1");
  }

  const client = new MercuryClient({ apiKey: opts.apiKey, baseUrl });

  const server = new McpServer({
    name: "mercury-invoicing-mcp",
    version: VERSION,
  });

  registerAllTools(server, client);

  return server;
}
