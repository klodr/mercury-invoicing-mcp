import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerTreasuryTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_get_treasury",
    "Retrieve Mercury Treasury account information (balance, interest rate, etc.).",
    {},
    async () => {
      const data = await client.get("/treasury");
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_list_treasury_transactions",
    "List transactions for a Mercury Treasury account.",
    {
      accountId: z.string().uuid().describe("Treasury account ID"),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
      start: z.iso.date().optional().describe("Filter after this date (YYYY-MM-DD)"),
      end: z.iso.date().optional().describe("Filter before this date (YYYY-MM-DD)"),
    },
    async ({ accountId, ...query }) => {
      const data = await client.get(`/treasury/${accountId}/transactions`, query);
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_list_treasury_statements",
    "List statements for a Mercury Treasury account.",
    {
      accountId: z.string().uuid().describe("Treasury account ID"),
    },
    async ({ accountId }) => {
      const data = await client.get(`/treasury/${accountId}/statements`);
      return textResult(data);
    },
  );
}
