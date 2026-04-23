import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Prompt for the Mercury IO Credit account workflow. Kept separate
 * from `recipes.ts` (which maps 1:1 to docs.mercury.com/recipes) —
 * this workflow has no upstream recipe because the IO Credit
 * endpoints are not in the public API reference (see
 * `src/tools/credit.ts` for the endpoint archaeology).
 */

const PendingCardTransactionsArgs = {
  sinceDays: z
    .string()
    .optional()
    .describe(
      "How far back to look, in days (e.g. `30`). Defaults to 30. Must be a positive integer " +
        "as a string so clients without numeric arg types pass through cleanly.",
    ),
  creditAccountHint: z
    .string()
    .optional()
    .describe(
      "Substring to match against a credit account's status or id (case-insensitive). Most " +
        "workspaces have a single IO Credit account, so this is rarely needed.",
    ),
};

export function registerCreditPrompts(server: McpServer): void {
  // --- /mercury-pending-card-transactions ---
  // Read-only: the user asks about state, not a mutation — no
  // confirmation gate, but the prompt still reminds the LLM that
  // a pending row can still be auth-reversed upstream of the
  // Mercury ledger (flips to `cancelled` on its own; the user does
  // not need to "do" anything about a pending row).
  //
  // Uses the IO Credit endpoints (mercury_list_credit_accounts +
  // mercury_list_credit_transactions) rather than mercury_list_cards
  // / mercury_list_transactions — the documented surface does not
  // return IO Credit data.
  server.registerPrompt(
    "mercury-pending-card-transactions",
    {
      title: "Pending card transactions on Mercury IO Credit (not yet settled)",
      description:
        "List pending (not-yet-settled) transactions on every Mercury IO Credit account. " +
        'Answers the "quelles sont mes dernieres transactions CB non payées?" question. ' +
        "Uses the undocumented `/credit` + `/account/{id}/transactions` endpoints the " +
        "Mercury Dashboard exercises.",
      argsSchema: PendingCardTransactionsArgs,
    },
    ({ sinceDays, creditAccountHint }) => {
      // Require a STRICTLY positive integer. `"0"` is syntactically a
      // digit-string but semantically would collapse the window to
      // "today only", producing a near-empty report at odds with the
      // advertised 30-day default. Reject both `"0"` and anything
      // non-numeric; fall back to `30`.
      const daysLabel = sinceDays && /^[1-9]\d*$/.test(sinceDays) ? sinceDays : "30";
      return {
        description: creditAccountHint
          ? `Pending IO Credit transactions on "${creditAccountHint}" over the last ${daysLabel} days`
          : `Pending IO Credit transactions over the last ${daysLabel} days`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Produce a read-only report of pending (not-yet-settled) Mercury IO Credit ` +
                `card transactions using the \`mercury_*\` tools:\n\n` +
                `1. Call \`mercury_list_credit_accounts\` (wraps the UNDOCUMENTED \`/credit\` ` +
                `endpoint — do NOT substitute \`mercury_list_accounts\`, which filters the ` +
                `IO Credit account out). The response shape is ` +
                `\`{ accounts: [{ id, status, availableBalance, currentBalance, … }] }\`. ` +
                `Collect the \`id\` of every account.` +
                (creditAccountHint
                  ? ` Scope to accounts whose status or id contains "${creditAccountHint}" ` +
                    `(case-insensitive). If no account matches, STOP and surface the mismatch — ` +
                    `do not silently widen back to every account.\n`
                  : `\n`) +
                `2. Compute the \`start\` date for the window: ${daysLabel} days ago in ` +
                `YYYY-MM-DD. Leave \`end\` unset (default = today).\n` +
                `3. For EACH credit \`accountId\` from step 1, call ` +
                `\`mercury_list_credit_transactions\` with:\n` +
                `   - accountId: <from step 1>\n` +
                `   - status: "pending"\n` +
                `   - start: <from step 2>\n` +
                `   - limit: 500\n` +
                `   This wraps the SINGULAR \`/account/{id}/transactions\` path (not the ` +
                `documented plural \`/accounts/{id}/transactions\` used for deposit ` +
                `accounts). Do NOT also page with \`offset\` unless the response has exactly ` +
                `500 rows.\n` +
                `4. Merge the results and produce ONE markdown table with columns: ` +
                `\`postedAt\` | \`counterparty\` | \`amount (USD)\` | \`memo\`. Sort by ` +
                `\`amount\` descending so the largest pending charges sit at the top. Format ` +
                `amounts as signed USD with two decimals (debits negative, any credits / ` +
                `refunds positive).\n` +
                `5. Below the table, print a one-line total: ` +
                `"<N> pending transactions, total <±$sum> over ${daysLabel} days".\n` +
                `6. Close with a single reminder line: "Pending Mercury IO Credit ` +
                `transactions may cancel on their own if the merchant reverses the auth — ` +
                `no action needed unless a row looks fraudulent." Do NOT call any write tool.`,
            },
          },
        ],
      };
    },
  );
}
