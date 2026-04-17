import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerStatementTools(server: McpServer, client: MercuryClient): void {
  server.tool(
    "mercury_list_statements",
    "List monthly statements for a Mercury account. Each statement has a downloadable PDF URL.",
    {
      accountId: z.string().describe("The Mercury account ID"),
      start: z.string().optional().describe("Filter statements from this date (YYYY-MM-DD)"),
      end: z.string().optional().describe("Filter statements to this date (YYYY-MM-DD)"),
    },
    async ({ accountId, ...query }) => {
      const data = await client.get(`/account/${accountId}/statements`, query);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
