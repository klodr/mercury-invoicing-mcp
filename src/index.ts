import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, VERSION } from "./server.js";

async function main(): Promise<void> {
  const apiKey = process.env.MERCURY_API_KEY;

  if (!apiKey) {
    console.error("ERROR: MERCURY_API_KEY environment variable is required.");
    console.error("Get your token at https://app.mercury.com/settings/tokens");
    process.exit(1);
  }

  const server = createServer({
    apiKey,
    baseUrl: process.env.MERCURY_API_BASE_URL,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`mercury-invoicing-mcp v${VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
