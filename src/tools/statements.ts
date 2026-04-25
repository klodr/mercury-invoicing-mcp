import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerStatementTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_statements",
    [
      "List monthly statements for a Mercury deposit account. Each statement has a downloadable PDF URL.",
      "",
      "USE WHEN: fetching the URL of a past statement (e.g. for accounting export, audit, or sharing with a CPA). The PDF URL is short-lived — re-fetch it shortly before download.",
      "",
      "DO NOT USE: for IO Credit account statements (Mercury exposes them only via the dashboard, not the API). For Treasury statements use `mercury_list_treasury_statements`.",
      "",
      "RETURNS: `{ statements: [{ id, periodStart, periodEnd, downloadUrl, ... }] }`.",
    ].join("\n"),
    {
      accountId: z.string().uuid().describe("The Mercury account ID"),
      start: z.iso.date().optional().describe("Filter statements from this date (YYYY-MM-DD)"),
      end: z.iso.date().optional().describe("Filter statements to this date (YYYY-MM-DD)"),
    },
    async ({ accountId, ...query }) => {
      const data = await client.get(`/account/${accountId}/statements`, query);
      return textResult(data);
    },
  );
}
