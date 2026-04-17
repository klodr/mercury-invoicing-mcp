#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MercuryClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const apiKey = process.env.MERCURY_API_KEY;

  if (!apiKey) {
    console.error("ERROR: MERCURY_API_KEY environment variable is required.");
    console.error("Get your token at https://app.mercury.com/settings/tokens");
    process.exit(1);
  }

  const client = new MercuryClient({ apiKey });

  const server = new McpServer({
    name: "mercury-invoicing-mcp",
    version: VERSION,
  });

  registerAllTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`mercury-invoicing-mcp v${VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
