import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MercuryClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";
import { wrapToolHandler } from "./middleware.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const apiKey = process.env.MERCURY_API_KEY;

  if (!apiKey) {
    console.error("ERROR: MERCURY_API_KEY environment variable is required.");
    console.error("Get your token at https://app.mercury.com/settings/tokens");
    process.exit(1);
  }

  // Auto-detect sandbox tokens (format: secret-token:mercury_sandbox_*)
  // unless MERCURY_API_BASE_URL is explicitly set.
  const isSandboxToken = apiKey.includes("mercury_sandbox_");
  const baseUrl =
    process.env.MERCURY_API_BASE_URL ??
    (isSandboxToken ? "https://api-sandbox.mercury.com/api/v1" : undefined);

  if (isSandboxToken && !process.env.MERCURY_API_BASE_URL) {
    console.error("Detected sandbox token → using https://api-sandbox.mercury.com/api/v1");
  }

  const client = new MercuryClient({ apiKey, baseUrl });

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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`mercury-invoicing-mcp v${VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
