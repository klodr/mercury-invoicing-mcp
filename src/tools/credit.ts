import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

/**
 * Mercury IO Credit Card facility.
 *
 * The IO Credit account is first-class in the Mercury Dashboard but
 * does NOT surface through the documented endpoints:
 *
 *   - `GET /accounts` (used by `mercury_list_accounts`) only returns
 *     deposit accounts (`kind: checking|savings|treasury|…`); the IO
 *     Credit account is filtered out server-side.
 *   - `GET /account/{id}/transactions` — the DOCUMENTED path is
 *     plural `/accounts/{id}/transactions` and returns deposit-side
 *     activity. The SINGULAR path `/account/{id}/transactions`
 *     (distinct route, same shape) is what the Dashboard hits for
 *     an IO Credit account. Same shape as deposit transactions but
 *     reachable only via the singular path for credit accounts.
 *
 * Endpoints are reverse-engineered from the Dashboard network
 * traffic (2026-04). They're not promised in the public API spec,
 * so treat them as best-effort: a breaking change on Mercury's
 * side will surface as a 404 from the two helpers below.
 *
 * Both helpers are read-only. See ROADMAP.md → "Mercury IO Credit
 * account exposure" for the tracking context.
 */

export function registerCreditTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_credit_accounts",
    "List Mercury IO Credit card accounts. Wraps the UNDOCUMENTED `GET /credit` endpoint " +
      "(not in the public API reference — reverse-engineered from the Mercury Dashboard). " +
      "Returns `{ accounts: [{ id, status, availableBalance, currentBalance, … }] }`. " +
      "Complement to `mercury_list_accounts`, which only returns deposit accounts.",
    {},
    async () => {
      const data = await client.get("/credit");
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_list_credit_transactions",
    "List transactions on a Mercury IO Credit card account, including pending (not-yet- " +
      "settled) card authorisations. Wraps the UNDOCUMENTED `GET /account/{id}/transactions` " +
      "(SINGULAR path — distinct from the documented plural `/accounts/{id}/transactions` used " +
      "for deposit accounts). Supports the same filters as `mercury_list_transactions`.",
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
  );
}
