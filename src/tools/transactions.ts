import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerTransactionTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_transactions",
    [
      "List transactions for a Mercury deposit account, with optional filters (date range, status, search).",
      "",
      "USE WHEN: auditing deposit-account activity, reconciling a statement, or building a per-account ledger view. Filters server-side: `status`, `start`, `end`, `search`, `limit`, `offset`.",
      "",
      "DO NOT USE: for IO Credit transactions (use `mercury_list_credit_transactions`, which targets the IO Credit account surface). For Treasury, use `mercury_list_treasury_transactions`.",
      "",
      "RETURNS: `{ transactions: [{ id, amount, status, postedAt, counterpartyName, ... }] }`.",
    ].join("\n"),
    {
      accountId: z.string().uuid().describe("The Mercury account ID"),
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
        .describe("Filter by transaction status"),
      start: z.iso.date().optional().describe("Filter posted on/after this date (YYYY-MM-DD)"),
      end: z.iso.date().optional().describe("Filter posted on/before this date (YYYY-MM-DD)"),
      search: z.string().optional().describe("Search query (counterparty name, memo, etc.)"),
    },
    async ({ accountId, ...query }) => {
      const data = await client.get(`/account/${accountId}/transactions`, query);
      return textResult(data);
    },
    { title: "List Transactions", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_get_transaction",
    [
      "Retrieve a specific transaction by ID for a Mercury deposit account.",
      "",
      "USE WHEN: fetching the full detail of one transaction whose ID is already known (typically from `mercury_list_transactions`). Faster than relisting + filtering.",
      "",
      "DO NOT USE: to enumerate transactions (use `mercury_list_transactions`). For IO Credit transactions, use `mercury_list_credit_transactions` and filter by id client-side.",
      "",
      "RETURNS: `{ id, amount, status, postedAt, counterpartyName, memo, ... }`.",
    ].join("\n"),
    {
      accountId: z.string().uuid().describe("The Mercury account ID"),
      transactionId: z.string().uuid().describe("The transaction ID"),
    },
    async ({ accountId, transactionId }) => {
      const data = await client.get(`/account/${accountId}/transaction/${transactionId}`);
      return textResult(data);
    },
    { title: "Get Transaction", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_send_money",
    [
      "Send money from a Mercury account to an external recipient via ACH, wire, or check. **REAL FUNDS LEAVE YOUR ACCOUNT.**",
      "",
      "USE WHEN: paying a vendor / contractor / counterparty whose `recipientId` already exists. ALWAYS confirm amount, recipient name, and payment method with the user before calling — the action is high-impact and largely irreversible (wires especially).",
      "",
      "DO NOT USE: to move money between your own Mercury accounts (use `mercury_create_internal_transfer`). To submit a payment that ALWAYS requires human approval regardless of workspace policy, use `mercury_request_send_money` instead.",
      "",
      "SIDE EFFECTS: **moves real money out of the account**. Whether the payment executes immediately or queues for approval depends entirely on **your Mercury workspace's approval policy** (Settings → Approvals on app.mercury.com) — the MCP cannot enforce this; Mercury does. On a $0-threshold workspace every send waits for sign-off; on a permissive workspace small payments may settle without re-prompting. Wires are usually irreversible once executed. **Idempotent via `idempotencyKey`** — auto-generated if not passed; pass an explicit one to make retries safe. Audit log entry on Mercury.",
      "",
      "RETURNS: `{ id, status, amount, ... }`. `status` reflects either immediate execution or pending-approval state, depending on workspace policy.",
    ].join("\n"),
    {
      accountId: z.string().uuid().describe("Source Mercury account ID"),
      recipientId: z.string().uuid().describe("Recipient ID (must already exist)"),
      amount: z.number().positive().describe("Amount in USD (e.g. 100.50)"),
      paymentMethod: z.enum(["ach", "wire", "check"]).describe("Payment method"),
      note: z.string().optional().describe("Internal note"),
      externalMemo: z.string().optional().describe("Memo visible to recipient"),
      idempotencyKey: z
        .string()
        .optional()
        .describe(
          "Unique key to prevent duplicate transfers. If not provided, a UUID is generated.",
        ),
    },
    async ({ accountId, idempotencyKey, ...body }) => {
      const idem = idempotencyKey ?? randomUUID();
      const data = await client.post(`/account/${accountId}/transactions`, {
        ...body,
        idempotencyKey: idem,
      });
      return textResult(data);
    },
    { title: "Send Money", destructiveHint: true, idempotentHint: true },
  );

  defineTool(
    server,
    "mercury_update_transaction",
    [
      "Update a transaction's internal note or category (no money movement).",
      "",
      "USE WHEN: tagging a transaction with a category for bookkeeping, or attaching an internal memo. Send `null` to clear a field, omit the key to keep the current value.",
      "",
      "DO NOT USE: to change the amount, counterparty, or status — those are immutable post-execution. Mercury endpoint is `PATCH /transaction/{id}` (no `accountId` in the path).",
      "",
      "SIDE EFFECTS: overwrites the note / category on Mercury's side. Persistent. Audit log on Mercury records the change. No effect on the booked transaction itself or on the counterparty.",
      "",
      "RETURNS: `{ id, note, categoryId, ... }` — the updated transaction.",
    ].join("\n"),
    {
      transactionId: z.string().uuid().describe("The transaction ID"),
      note: z
        .string()
        .nullable()
        .optional()
        .describe("Internal note (send null to clear, omit to keep current)"),
      categoryId: z
        .string()
        .uuid()
        .nullable()
        .optional()
        .describe(
          "Category ID (UUID, see mercury_list_categories). Send null to clear, omit to keep current.",
        ),
    },
    async ({ transactionId, ...body }) => {
      const data = await client.patch(`/transaction/${transactionId}`, body);
      return textResult(data);
    },
    { title: "Update Transaction", destructiveHint: false },
  );

  defineTool(
    server,
    "mercury_create_internal_transfer",
    [
      "Move money between two of your own Mercury accounts (e.g. Checking → Savings). Funds stay inside your organisation.",
      "",
      "USE WHEN: rebalancing cash between your own Mercury accounts — sweeping idle deposits to Treasury, funding a sub-account before issuing cards, etc. Both accounts must belong to your workspace.",
      "",
      "DO NOT USE: to send money to an external counterparty (use `mercury_send_money`). To request approval-gated movement, use `mercury_request_send_money` (different surface, external only).",
      "",
      "SIDE EFFECTS: **moves real money** between two accounts you own. Settles immediately, no approval workflow because no external recipient is involved. Persistent ledger entries on both sides. **Idempotent via `idempotencyKey`** — auto-generated if omitted, but pass an explicit one to make retries safe.",
      "",
      "RETURNS: `{ id, amount, status, ... }` — the booked transfer.",
    ].join("\n"),
    {
      sourceAccountId: z.string().uuid().describe("Source Mercury account ID"),
      destinationAccountId: z.string().uuid().describe("Destination Mercury account ID"),
      amount: z.number().min(0.01).describe("Amount in USD (>= 0.01)"),
      note: z.string().optional().describe("Optional note attached to the transfer"),
      idempotencyKey: z
        .string()
        .optional()
        .describe("Unique key to prevent duplicate transfers. Auto-generated if omitted."),
    },
    async ({ idempotencyKey, ...body }) => {
      const idem = idempotencyKey ?? randomUUID();
      const data = await client.post(`/transfer`, { ...body, idempotencyKey: idem });
      return textResult(data);
    },
    { title: "Create Internal Transfer", destructiveHint: false, idempotentHint: true },
  );

  defineTool(
    server,
    "mercury_request_send_money",
    [
      "Request to send money — Mercury creates a **pending approval request** that a human must approve before any funds move. ALWAYS creates an approval request, regardless of workspace policy.",
      "",
      'USE WHEN: submitting an outbound payment that should always wait for human sign-off — for safety, audit, or because workspace policy demands it. Pairs naturally with the "submit, then wait for approver" workflow.',
      "",
      "DO NOT USE: when you intend to transfer between your own accounts (use `mercury_create_internal_transfer` — no external recipient). For payments that may execute immediately under workspace policy, use `mercury_send_money` (different surface).",
      "",
      "SIDE EFFECTS: creates a **pending approval request** on Mercury — no money has moved at this point. A human approver must sign off in the Mercury web/mobile app. Once approved, Mercury executes the underlying ACH / wire / check. **Idempotent via `idempotencyKey`** — auto-generated if not passed. Audit log entry on Mercury for the request itself.",
      "",
      'RETURNS: `{ id, status: "pendingApproval", amount, ... }` — track via `mercury_get_transaction` once executed.',
    ].join("\n"),
    {
      accountId: z.string().uuid().describe("Source Mercury account ID"),
      recipientId: z.string().uuid().describe("Recipient ID"),
      amount: z.number().positive().describe("Amount in USD"),
      paymentMethod: z.enum(["ach", "wire", "check"]).describe("Payment method"),
      note: z.string().optional(),
      externalMemo: z.string().optional(),
      idempotencyKey: z.string().optional(),
    },
    async ({ accountId, idempotencyKey, ...body }) => {
      const idem = idempotencyKey ?? randomUUID();
      const data = await client.post(`/account/${accountId}/request-send-money`, {
        ...body,
        idempotencyKey: idem,
      });
      return textResult(data);
    },
    { title: "Request Send Money", destructiveHint: true, idempotentHint: true },
  );
}
