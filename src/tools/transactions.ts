import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerTransactionTools(server: McpServer, client: MercuryClient): void {
  defineTool(server, 
    "mercury_list_transactions",
    "List transactions for a Mercury account, with optional filters (date range, status, search).",
    {
      accountId: z.string().describe("The Mercury account ID"),
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
      start: z.string().optional().describe("Filter posted on/after this date (YYYY-MM-DD)"),
      end: z.string().optional().describe("Filter posted on/before this date (YYYY-MM-DD)"),
      search: z.string().optional().describe("Search query (counterparty name, memo, etc.)"),
    },
    async ({ accountId, ...query }) => {
      const data = await client.get(`/account/${accountId}/transactions`, query);
      return textResult(data);
    }
  );

  defineTool(server, 
    "mercury_get_transaction",
    "Retrieve a specific transaction by ID for a Mercury account.",
    {
      accountId: z.string().describe("The Mercury account ID"),
      transactionId: z.string().describe("The transaction ID"),
    },
    async ({ accountId, transactionId }) => {
      const data = await client.get(`/account/${accountId}/transaction/${transactionId}`);
      return textResult(data);
    }
  );

  defineTool(server, 
    "mercury_send_money",
    "Send money from a Mercury account via ACH or wire. Requires read-write API token.",
    {
      accountId: z.string().describe("Source Mercury account ID"),
      recipientId: z.string().describe("Recipient ID (must already exist)"),
      amount: z.number().positive().describe("Amount in USD (e.g. 100.50)"),
      paymentMethod: z
        .enum(["ach", "wire", "check"])
        .describe("Payment method"),
      note: z.string().optional().describe("Internal note"),
      externalMemo: z.string().optional().describe("Memo visible to recipient"),
      idempotencyKey: z
        .string()
        .optional()
        .describe(
          "Unique key to prevent duplicate transfers. If not provided, a UUID is generated."
        ),
    },
    async ({ accountId, idempotencyKey, ...body }) => {
      const idem = idempotencyKey ?? randomUUID();
      const data = await client.post(`/account/${accountId}/transactions`, {
        ...body,
        idempotencyKey: idem,
      });
      return textResult(data);
    }
  );

  defineTool(server, 
    "mercury_update_transaction",
    "Update a transaction's note, memo, or category. Useful for bookkeeping.",
    {
      accountId: z.string().describe("The Mercury account ID"),
      transactionId: z.string().describe("The transaction ID"),
      note: z.string().optional().describe("Internal note"),
      externalMemo: z.string().optional().describe("Memo visible to counterparty"),
      categoryId: z.string().optional().describe("Category ID (see mercury_list_categories)"),
    },
    async ({ accountId, transactionId, ...body }) => {
      const data = await client.patch(`/account/${accountId}/transaction/${transactionId}`, body);
      return textResult(data);
    }
  );

  // Note: Mercury does not expose listing pending request_send_money calls
  // via the API (GET /account/{id}/request-send-money returns 405).
  // The endpoint is POST-only for creating new requests.

  defineTool(server, 
    "mercury_request_send_money",
    "Request to send money (requires admin approval before processing). Requires read-write API token.",
    {
      accountId: z.string().describe("Source Mercury account ID"),
      recipientId: z.string().describe("Recipient ID"),
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
    }
  );
}
