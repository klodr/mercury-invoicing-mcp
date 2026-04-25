import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

/**
 * Mercury IO Credit Card facility.
 *
 * The IO Credit account is first-class in the Mercury Dashboard and
 * exposed via two routes:
 *
 *   - `GET /credit` — listed under "Credit › List all credit accounts"
 *     in the Mercury API reference (https://docs.mercury.com/reference/credit).
 *     Returns IO Credit card accounts. Complement to `GET /accounts`,
 *     which only returns deposit accounts (`kind: checking|savings|treasury|…`).
 *   - `GET /account/{id}/transactions` — SINGULAR-`account` path. Same
 *     path Mercury exposes for deposit-account transactions, which the
 *     `mercury_list_transactions` helper also calls. Same response shape.
 *
 * Both helpers are read-only. See docs/ROADMAP.md → "Mercury IO Credit
 * account exposure" for the tracking context.
 */

export function registerCreditTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_credit_accounts",
    [
      "List Mercury IO Credit card accounts (charge cards, distinct from deposit accounts).",
      "",
      "USE WHEN: enumerating IO Credit accounts to find their balance, statement closing date, or to feed an ID into `mercury_list_credit_transactions`. Wraps `GET /credit` (documented under Credit › List all credit accounts in the Mercury API reference).",
      "",
      "DO NOT USE: for deposit accounts (checking/savings/treasury) — use `mercury_list_accounts`, which hits a different endpoint (`/accounts`).",
      "",
      "RETURNS: `{ accounts: [{ id, status, availableBalance, currentBalance, ... }] }`.",
    ].join("\n"),
    {},
    async () => {
      const data = await client.get("/credit");
      return textResult(data);
    },
    { title: "List Credit Accounts", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_list_credit_transactions",
    [
      "List transactions on a Mercury IO Credit card account, including pending (not-yet-settled) card authorisations.",
      "",
      "USE WHEN: auditing IO Credit card spend, reconciling a statement, or building a card-level transaction view. Wraps `GET /account/{id}/transactions` — same path Mercury exposes for deposit-account transactions; both this tool and `mercury_list_transactions` hit it. Supports the same filters.",
      "",
      'DO NOT USE: for deposit-account transactions (use `mercury_list_transactions`). For posted transactions only, filter by `status: "sent"`.',
      "",
      "RETURNS: `{ transactions: [{ id, amount, status, postedAt, counterpartyName, ... }] }`. `pending` items are card authorisations that may still be reversed.",
    ].join("\n"),
    {
      accountId: z
        .string()
        .uuid()
        .describe("The Mercury IO Credit account ID (from mercury_list_credit_accounts)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Max results to return (1-500). Default: 500"),
      offset: z.number().int().min(0).optional().describe("Pagination offset"),
      status: z
        .enum(["pending", "sent", "cancelled", "failed"])
        .optional()
        .describe("Filter by transaction status. `pending` = card auth not yet settled."),
      start: z.iso.date().optional().describe("Filter posted on/after this date (YYYY-MM-DD)"),
      end: z.iso.date().optional().describe("Filter posted on/before this date (YYYY-MM-DD)"),
      search: z.string().optional().describe("Search query (counterparty name, memo, etc.)"),
    },
    async ({ accountId, ...query }) => {
      const data = await client.get(`/account/${accountId}/transactions`, query);
      return textResult(data);
    },
    { title: "List Credit Transactions", readOnlyHint: true },
  );
}
