import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

const lineItemSchema = z.object({
  name: z.string().describe("Line item name (required by Mercury, shown on the invoice)"),
  description: z.string().optional().describe("Optional longer description"),
  quantity: z.number().positive().describe("Quantity"),
  unitPrice: z.number().nonnegative().describe("Price per unit in USD"),
});

export function registerInvoiceTools(server: McpServer, client: MercuryClient): void {
  defineTool(server, 
    "mercury_list_invoices",
    "List invoices in your Mercury workspace, with cursor-based pagination.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max results to return (1-1000). Default: 1000"),
      order: z.enum(["asc", "desc"]).optional().describe("Sort order. Default: asc"),
      startAfter: z
        .string()
        .uuid()
        .optional()
        .describe("Pagination: return invoices after this ID"),
      endBefore: z
        .string()
        .uuid()
        .optional()
        .describe("Pagination: return invoices before this ID"),
    },
    async (args) => {
      const query: Record<string, string | number | undefined> = {
        limit: args.limit,
        order: args.order,
        start_after: args.startAfter,
        end_before: args.endBefore,
      };
      const data = await client.get("/ar/invoices", query);
      return textResult(data);
    }
  );

  defineTool(server, 
    "mercury_get_invoice",
    "Retrieve a specific invoice by ID.",
    {
      invoiceId: z.string().uuid().describe("The invoice ID (UUID)"),
    },
    async ({ invoiceId }) => {
      const data = await client.get(`/ar/invoices/${invoiceId}`);
      return textResult(data);
    }
  );

  defineTool(server, 
    "mercury_create_invoice",
    "Create a new invoice (one-shot or to be sent recurrently). Requires AR write scope.",
    {
      customerId: z.string().uuid().describe("Customer ID (created via mercury_create_customer)"),
      destinationAccountId: z
        .string()
        .uuid()
        .describe("Mercury account ID where invoice payments will be deposited"),
      invoiceDate: z.string().describe("Invoice date (YYYY-MM-DD)"),
      dueDate: z.string().describe("Due date (YYYY-MM-DD)"),
      lineItems: z.array(lineItemSchema).min(1).describe("Invoice line items"),
      achDebitEnabled: z
        .boolean()
        .optional()
        .describe("Allow ACH debit payments. Default: true"),
      creditCardEnabled: z
        .boolean()
        .optional()
        .describe("Allow credit card payments. Default: true"),
      useRealAccountNumber: z
        .boolean()
        .optional()
        .describe("Show real (vs virtual) account number on the invoice. Default: false"),
      ccEmails: z.array(z.string().email()).optional().describe("CC emails for notifications"),
      sendEmailOption: z
        .enum(["DontSend", "SendNow"])
        .optional()
        .describe("Whether to email the invoice immediately. Default: SendNow"),
      invoiceNumber: z.string().optional().describe("Customer-facing invoice number"),
      poNumber: z.string().optional().describe("Purchase order number"),
      payerMemo: z.string().optional().describe("Memo shown to payer"),
      internalNote: z.string().optional().describe("Note visible only to your org"),
      servicePeriodStartDate: z.string().optional().describe("Service period start (YYYY-MM-DD)"),
      servicePeriodEndDate: z.string().optional().describe("Service period end (YYYY-MM-DD)"),
    },
    async (args) => {
      const body = {
        ...args,
        achDebitEnabled: args.achDebitEnabled ?? true,
        creditCardEnabled: args.creditCardEnabled ?? true,
        useRealAccountNumber: args.useRealAccountNumber ?? false,
        ccEmails: args.ccEmails ?? [],
      };
      const data = await client.post("/ar/invoices", body);
      return textResult(data);
    }
  );

  defineTool(server,
    "mercury_update_invoice",
    "Update an existing invoice. Pass only the fields you want to change; the MCP fetches the current invoice and merges your changes before submitting (Mercury's update endpoint requires the full payload, even though the API documents it as PATCH-style).",
    {
      invoiceId: z.string().uuid().describe("Invoice ID"),
      invoiceDate: z.string().optional().describe("Invoice date (YYYY-MM-DD)"),
      dueDate: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      lineItems: z.array(lineItemSchema).optional(),
      ccEmails: z.array(z.string().email()).optional(),
      payerMemo: z.string().optional(),
      internalNote: z.string().optional(),
      poNumber: z.string().optional(),
      invoiceNumber: z.string().optional(),
    },
    async ({ invoiceId, ...changes }) => {
      const current = await client.get<Record<string, unknown>>(
        `/ar/invoices/${invoiceId}`,
      );
      // Strip read-only fields Mercury rejects in the update payload
      const { id: _i, slug: _s, status: _st, amount: _a, createdAt: _c, updatedAt: _u, ...editable } = current;
      const merged: Record<string, unknown> = { ...editable };
      for (const [k, v] of Object.entries(changes)) {
        if (v !== undefined) merged[k] = v;
      }
      const data = await client.post(`/ar/invoices/${invoiceId}`, merged);
      return textResult(data);
    }
  );

  // Note: Mercury does not expose POST /ar/invoices/{id}/send via the public
  // API (404 confirmed). The only way to email an invoice is via
  // sendEmailOption: "SendNow" at creation time (mercury_create_invoice).

  defineTool(server,
    "mercury_cancel_invoice",
    "Cancel an outstanding invoice.",
    {
      invoiceId: z.string().uuid().describe("Invoice ID"),
    },
    async ({ invoiceId }) => {
      const data = await client.post(`/ar/invoices/${invoiceId}/cancel`);
      return textResult(data);
    }
  );

  defineTool(server, 
    "mercury_list_invoice_attachments",
    "List attachments associated with an invoice.",
    {
      invoiceId: z.string().uuid().describe("Invoice ID"),
    },
    async ({ invoiceId }) => {
      const data = await client.get(`/ar/invoices/${invoiceId}/attachments`);
      return textResult(data);
    }
  );
}
