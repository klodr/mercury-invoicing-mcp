import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

  server.tool(
    "mercury_list_treasury_transactions",
    "List transactions for a Mercury Treasury account.",
    {
      accountId: z.string().describe("Treasury account ID"),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
      start: z.string().optional().describe("Filter after this date (YYYY-MM-DD)"),
      end: z.string().optional().describe("Filter before this date (YYYY-MM-DD)"),
    },
    async ({ accountId, ...query }) => {
      const data = await client.get(`/treasury/${accountId}/transactions`, query);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "mercury_list_treasury_statements",
    "List statements for a Mercury Treasury account.",
    {
      accountId: z.string().describe("Treasury account ID"),
    },
    async ({ accountId }) => {
      const data = await client.get(`/treasury/${accountId}/statements`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
