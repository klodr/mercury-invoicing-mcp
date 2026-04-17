import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

const lineItemSchema = z.object({
  description: z.string().describe("Description of the line item"),
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
    "Update an existing invoice (typically for draft invoices). Pass only the fields you want to change.",
    {
      invoiceId: z.string().uuid().describe("Invoice ID"),
      dueDate: z.string().optional().describe("New due date (YYYY-MM-DD)"),
      lineItems: z.array(lineItemSchema).optional(),
      ccEmails: z.array(z.string().email()).optional(),
      payerMemo: z.string().optional(),
      internalNote: z.string().optional(),
      poNumber: z.string().optional(),
      invoiceNumber: z.string().optional(),
    },
    async ({ invoiceId, ...body }) => {
      const data = await client.patch(`/ar/invoices/${invoiceId}`, body);
      return textResult(data);
    }
  );

  defineTool(server, 
    "mercury_send_invoice",
    "Send an invoice email to the customer. Useful when an invoice was created with sendEmailOption='DontSend'.",
    {
      invoiceId: z.string().uuid().describe("Invoice ID"),
    },
    async ({ invoiceId }) => {
      const data = await client.post(`/ar/invoices/${invoiceId}/send`);
      return textResult(data);
    }
  );

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
