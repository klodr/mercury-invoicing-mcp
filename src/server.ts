import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";
import { wrapToolHandler } from "./middleware.js";

export const VERSION = "0.1.0";
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
  if (apiKey.includes("mercury_sandbox_")) return SANDBOX_BASE_URL;
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

  // Monkey-patch server.tool to wrap every handler with rate limit / dry-run / audit middleware.
  // Read tools pass through unchanged (no category → no rate limit, no dry-run interference).
  const originalTool = server.tool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (
    ...args: unknown[]
  ) => {
    const lastIdx = args.length - 1;
    if (typeof args[lastIdx] === "function" && typeof args[0] === "string") {
      const toolName = args[0];
      const handler = args[lastIdx] as (a: unknown) => Promise<{
        content: { type: "text"; text: string }[];
        isError?: boolean;
      }>;
      args[lastIdx] = wrapToolHandler(toolName, handler);
    }
    return originalTool(...args);
  };

  registerAllTools(server, client);

  return server;
}
