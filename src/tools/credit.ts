import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";
import { compactTransactionList } from "../project.js";

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
    { title: "List Credit Accounts", readOnlyHint: true, openWorldHint: true },
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
      'RETURNS (default `detail: "compact"`): `{ transactions: [{ id, amount, status, kind, postedAt, counterpartyName, categoryName, hasAttachment, ... }] }`. `pending` items are card authorisations that may still be reversed. `hasAttachment` is always present, true or false — it answers "which card charges are still missing a receipt". Receipt **URLs are never returned here**; get one deliberately via `mercury_get_transaction_attachment`. Pass `detail: "full"` for every Mercury field.',
    ].join("\n"),
    {
      accountId: z
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
      detail: z
        .enum(["compact", "full"])
        .optional()
        .describe(
          'Payload shape. "compact" (default) projects to identifying fields and reports receipts as a boolean. "full" returns every Mercury field — attachment URLs are stripped in both modes.',
        ),
    },
    async ({ accountId, detail, ...query }) => {
      const data = await client.get(`/account/${accountId}/transactions`, query);
      return textResult(compactTransactionList(data, detail ?? "compact"));
    },
    { title: "List Credit Transactions", readOnlyHint: true, openWorldHint: true },
  );
}
