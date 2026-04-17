import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerCardTools(server: McpServer, client: MercuryClient): void {
  defineTool(server, 
    "mercury_list_cards",
    "List credit/debit cards attached to a Mercury account.",
    {
      accountId: z.string().describe("The Mercury account ID"),
    },
    async ({ accountId }) => {
      const data = await client.get(`/account/${accountId}/cards`);
      return textResult(data);
    }
  );
}
