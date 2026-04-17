import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerAccountTools(server: McpServer, client: MercuryClient): void {
  server.tool(
    "mercury_list_accounts",
    "List all bank accounts in your Mercury workspace.",
    {},
    async () => {
      const data = await client.get("/accounts");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "mercury_get_account",
    "Retrieve details for a specific Mercury bank account by ID.",
    {
      accountId: z.string().describe("The Mercury account ID"),
    },
    async ({ accountId }) => {
      const data = await client.get(`/account/${accountId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
