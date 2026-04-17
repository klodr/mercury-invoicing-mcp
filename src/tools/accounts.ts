import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerAccountTools(server: McpServer, client: MercuryClient): void {
  defineTool(server, 
    "mercury_list_accounts",
    "List all bank accounts in your Mercury workspace.",
    {},
    async () => {
      const data = await client.get("/accounts");
      return textResult(data);
    }
  );

  defineTool(server, 
    "mercury_get_account",
    "Retrieve details for a specific Mercury bank account by ID.",
    {
      accountId: z.string().uuid().describe("The Mercury account ID"),
    },
    async ({ accountId }) => {
      const data = await client.get(`/account/${accountId}`);
      return textResult(data);
    }
  );
}
