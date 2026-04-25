import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerTreasuryTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_get_treasury",
    [
      "Retrieve Mercury Treasury account information (balance, current yield, eligibility, etc.).",
      "",
      "USE WHEN: checking treasury cash balance or yield for cash-management decisions, or to confirm the workspace has Treasury enabled.",
      "",
      "DO NOT USE: for deposit accounts (use `mercury_get_account`). For Treasury transactions or statements, use the dedicated list tools.",
      "",
      "RETURNS: `{ id, currentBalance, yield, eligibility, ... }`.",
    ].join("\n"),
    {},
    async () => {
      const data = await client.get("/treasury");
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_list_treasury_transactions",
    [
      "List transactions for a Mercury Treasury account (sweeps, dividend accruals, etc.).",
      "",
      "USE WHEN: auditing Treasury cash flows, reconciling yield accruals, or building a Treasury-only ledger view.",
      "",
      "DO NOT USE: for deposit-account transactions (use `mercury_list_transactions`). For IO Credit transactions, use `mercury_list_credit_transactions`.",
      "",
      "RETURNS: `{ transactions: [{ id, amount, kind, postedAt, ... }] }`.",
    ].join("\n"),
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
    [
      "List monthly statements for a Mercury Treasury account.",
      "",
      "USE WHEN: fetching the URL of a past Treasury statement for tax/audit export. PDF URL is short-lived — fetch it shortly before download.",
      "",
      "DO NOT USE: for deposit-account statements (use `mercury_list_statements`). IO Credit statements are not exposed via the API.",
      "",
      "RETURNS: `{ statements: [{ id, periodStart, periodEnd, downloadUrl, ... }] }`.",
    ].join("\n"),
    {
      accountId: z.string().uuid().describe("Treasury account ID"),
    },
    async ({ accountId }) => {
      const data = await client.get(`/treasury/${accountId}/statements`);
      return textResult(data);
    },
  );
}
