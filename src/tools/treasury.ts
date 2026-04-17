import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "../client.js";

export function registerTreasuryTools(server: McpServer, client: MercuryClient): void {
  server.tool(
    "mercury_get_treasury",
    "Retrieve Mercury Treasury account information (balance, interest rate, etc.).",
    {},
    async () => {
      const data = await client.get("/treasury");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
