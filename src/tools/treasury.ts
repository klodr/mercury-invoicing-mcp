import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";
import { compactTransactionList, compactTreasuryTransaction } from "../project.js";

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
    { title: "Get Treasury", readOnlyHint: true, openWorldHint: true },
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
      "⚠️ **This endpoint has no date filter.** Unlike `mercury_list_transactions`, Treasury accepts only `limit`, `order` and `cursor` — there is no `start`/`end`. To audit a period, page through the transactions and filter on `canonicalDay` (the Treasury row date, `YYYY-MM-DD`) yourself.",
      "",
      "⚠️ **Pagination is cursor-based, not offset-based.** Pass the top-level `cursor` of the response as the `cursor` of the next call, and stop when it is `null` or absent — a short page is not the end signal. Passing an `offset` does nothing — Mercury ignores it and you silently re-read page 1.",
      "",
      'RETURNS (default `detail: "compact"`): `{ transactions: [{ id, type, description, amount, balance, canonicalDay, security, details, ... }], cursor }` — null fields omitted. Pass `detail: "full"` for every Mercury field (`accountId`, null fields).',
    ].join("\n"),
    {
      accountId: z.uuid().describe("Treasury account ID"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max rows to return (default 100)"),
      cursor: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination cursor: the top-level `cursor` of the previous response"),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .describe('Sort order on the transaction date. Defaults to "desc".'),
      detail: z
        .enum(["compact", "full"])
        .optional()
        .describe(
          'Payload shape. "compact" (default) keeps the Treasury fields that identify, date and reconcile a row; "full" returns every Mercury field.',
        ),
    },
    async ({ accountId, detail, ...query }) => {
      const data = await client.get(`/treasury/${accountId}/transactions`, query);
      return textResult(
        compactTransactionList(data, detail ?? "compact", compactTreasuryTransaction),
      );
    },
    { title: "List Treasury Transactions", readOnlyHint: true, openWorldHint: true },
  );

  defineTool(
    server,
    "mercury_list_treasury_statements",
    [
      "List monthly statements for a Mercury Treasury account.",
      "",
      "USE WHEN: fetching the URL of a past Treasury statement for tax/audit export. PDF URL is short-lived — fetch it shortly before download.",
      "",
      "DO NOT USE: for deposit-account statements (use `mercury_list_statements`). For IO Credit card statements use `mercury_list_credit_statements`.",
      "",
      "RETURNS: `{ statements: [{ id, periodStart, periodEnd, downloadUrl, ... }] }`.",
    ].join("\n"),
    {
      accountId: z.uuid().describe("Treasury account ID"),
    },
    async ({ accountId }) => {
      const data = await client.get(`/treasury/${accountId}/statements`);
      return textResult(data);
    },
    { title: "List Treasury Statements", readOnlyHint: true, openWorldHint: true },
  );
}
