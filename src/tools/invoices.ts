import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

const lineItemSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Line item name (required, ≤200 characters — Mercury rejects longer values on the edit endpoint with 'Item name: Must be 200 characters or fewer', leaving the invoice unmodifiable). Put long descriptions in the optional `description` field or in the attached invoice PDF.",
    ),
  description: z.string().optional().describe("Optional longer description"),
  quantity: z.number().positive().describe("Quantity"),
  unitPrice: z.number().nonnegative().describe("Price per unit in USD"),
});

export function registerInvoiceTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_invoices",
    [
      "List invoices in your Mercury workspace, with cursor-based pagination.",
      "",
      "USE WHEN: enumerating invoices for an AR audit, finding the ID of an invoice to update/cancel, or building a dunning report. Use `startAfter` / `endBefore` to page beyond the limit.",
      "",
      "DO NOT USE: for one invoice whose ID is known (prefer `mercury_get_invoice`). Mercury does not currently support filtering by status or customer at the API level — filter client-side after listing.",
      "",
      "RETURNS: `{ invoices: [{ id, status, amount, customerId, dueDate, ... }] }`.",
    ].join("\n"),
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
    },
    { title: "List Invoices", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_get_invoice",
    [
      "Retrieve a specific invoice by ID, including line items, status, and the payment URL.",
      "",
      "USE WHEN: fetching the full detail of one invoice (line items, current status, balance due, payment URL) whose ID is already known.",
      "",
      "DO NOT USE: to enumerate invoices (use `mercury_list_invoices`). For attachments use `mercury_list_invoice_attachments`.",
      "",
      "RETURNS: `{ id, status, amount, customerId, lineItems, paymentUrl, dueDate, ... }`.",
    ].join("\n"),
    {
      invoiceId: z.string().uuid().describe("The invoice ID (UUID)"),
    },
    async ({ invoiceId }) => {
      const data = await client.get(`/ar/invoices/${invoiceId}`);
      return textResult(data);
    },
    { title: "Get Invoice", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_create_invoice",
    [
      "Create a new invoice (one-shot or to be sent recurrently). Requires AR write scope.",
      "",
      'USE WHEN: billing a customer that already exists in Mercury (`customerId` from `mercury_create_customer` or `mercury_list_customers`). Set `sendEmailOption: "SendNow"` to email the invoice immediately to the customer\'s contact email.',
      "",
      "DO NOT USE: when the customer does not exist yet (call `mercury_create_customer` first). To attach a file to the invoice, use the Mercury web app at creation time — the API attachment-upload endpoint is not exposed by this MCP currently.",
      "",
      'SIDE EFFECTS: writes a new invoice to Mercury. Persistent. With `sendEmailOption: "SendNow"` (the default), Mercury also sends a real email with a payment link to the customer — confirm the customer\'s email and the line items before calling. Mercury Plus tier required for the AR write scope.',
      "",
      "RETURNS: `{ id, status, amount, paymentUrl, ... }` — `paymentUrl` is the Mercury-hosted page where the customer pays.",
    ].join("\n"),
    {
      customerId: z.string().uuid().describe("Customer ID (created via mercury_create_customer)"),
      destinationAccountId: z
        .string()
        .uuid()
        .describe("Mercury account ID where invoice payments will be deposited"),
      invoiceDate: z.iso.date().describe("Invoice date (YYYY-MM-DD)"),
      dueDate: z.iso.date().describe("Due date (YYYY-MM-DD)"),
      lineItems: z.array(lineItemSchema).min(1).describe("Invoice line items"),
      achDebitEnabled: z.boolean().optional().describe("Allow ACH debit payments. Default: true"),
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
      invoiceNumber: z
        .string()
        .max(255)
        .optional()
        .describe(
          "Customer-facing invoice number (≤255 chars; Mercury rejects 300+ characters on the edit endpoint)",
        ),
      poNumber: z.string().optional().describe("Purchase order number"),
      payerMemo: z.string().optional().describe("Memo shown to payer"),
      internalNote: z.string().optional().describe("Note visible only to your org"),
      servicePeriodStartDate: z.iso.date().optional().describe("Service period start (YYYY-MM-DD)"),
      servicePeriodEndDate: z.iso.date().optional().describe("Service period end (YYYY-MM-DD)"),
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
    },
    { title: "Create Invoice", destructiveHint: false },
  );

  defineTool(
    server,
    "mercury_update_invoice",
    [
      "Update an existing invoice. Pass only the fields you want to change.",
      "",
      "USE WHEN: amending an outstanding invoice (line items, due date, memo, PO number) before the customer pays. The MCP fetches the current invoice and merges your changes before submitting — Mercury's update endpoint requires the full payload despite the API docs implying PATCH.",
      "",
      "DO NOT USE: to cancel an invoice (use `mercury_cancel_invoice`). To change the customer or the destination account, cancel + recreate. Once an invoice is paid, updates are likely rejected by Mercury — fetch first to confirm status.",
      "",
      "SIDE EFFECTS: overwrites the invoice on Mercury's side. The customer-facing payment URL stays the same. If the invoice was already emailed, the customer is NOT re-notified of the change — communicate the change out-of-band if needed.",
      "",
      "RETURNS: `{ id, status, amount, ... }` — the updated invoice.",
    ].join("\n"),
    {
      invoiceId: z.string().uuid().describe("Invoice ID"),
      invoiceDate: z.iso.date().optional().describe("Invoice date (YYYY-MM-DD)"),
      dueDate: z.iso.date().optional().describe("Due date (YYYY-MM-DD)"),
      lineItems: z.array(lineItemSchema).optional(),
      ccEmails: z.array(z.string().email()).optional(),
      payerMemo: z.string().optional(),
      internalNote: z.string().optional(),
      poNumber: z.string().optional(),
      invoiceNumber: z.string().optional(),
    },
    async ({ invoiceId, ...changes }) => {
      const current = await client.get<Record<string, unknown>>(`/ar/invoices/${invoiceId}`);
      // Strip read-only fields Mercury rejects in the update payload
      const {
        id: _i,
        slug: _s,
        status: _st,
        amount: _a,
        createdAt: _c,
        updatedAt: _u,
        ...editable
      } = current;
      const merged: Record<string, unknown> = { ...editable };
      for (const [k, v] of Object.entries(changes)) {
        // Zod-validated args never carry undefined values (optional keys
        // are elided), so the false branch is a defensive guard rather
        // than a runtime path we can hit.
        /* v8 ignore next */
        if (v !== undefined) merged[k] = v;
      }
      const data = await client.post(`/ar/invoices/${invoiceId}`, merged);
      return textResult(data);
    },
    { title: "Update Invoice", destructiveHint: false },
  );

  // Note: Mercury does not expose POST /ar/invoices/{id}/send via the public
  // API (404 confirmed). The only way to email an invoice is via
  // sendEmailOption: "SendNow" at creation time (mercury_create_invoice).

  defineTool(
    server,
    "mercury_cancel_invoice",
    [
      "Cancel an outstanding invoice. **Mercury sends a cancellation notice to the customer if the invoice was already emailed.**",
      "",
      "USE WHEN: voiding an invoice that was issued in error, that the customer disputes, or that needs to be re-issued under a corrected line-item set. ALWAYS confirm with the user before calling — the customer-facing notification is automatic.",
      "",
      "DO NOT USE: on an invoice already paid (Mercury rejects cancellation). To refund a paid invoice, refund out-of-band via the bank, then optionally update the internal note.",
      "",
      "SIDE EFFECTS: marks the invoice as `cancelled` on Mercury. The customer-facing payment URL stops accepting payments. If the invoice was emailed, **Mercury notifies the customer of the cancellation by email** — confirm with the user before calling. The action is logged in Mercury's audit trail. Cancellation is final from the API perspective.",
      "",
      'RETURNS: `{ id, status: "cancelled", ... }`.',
    ].join("\n"),
    {
      invoiceId: z.string().uuid().describe("Invoice ID"),
    },
    async ({ invoiceId }) => {
      const data = await client.post(`/ar/invoices/${invoiceId}/cancel`);
      return textResult(data);
    },
    { title: "Cancel Invoice", destructiveHint: true },
  );

  defineTool(
    server,
    "mercury_list_invoice_attachments",
    [
      "List attachments associated with an invoice (PDF copies, supporting documents).",
      "",
      "USE WHEN: discovering which files were attached to an invoice — for archival, audit, or to share with a customer. The download URL is short-lived; refetch shortly before download.",
      "",
      "DO NOT USE: to upload an attachment — this MCP currently exposes only the read side. Mercury's API does support attachment upload (`POST /ar/invoices/{id}/attachments`); a write tool can be added if needed.",
      "",
      "RETURNS: `{ attachments: [{ id, filename, downloadUrl, ... }] }`.",
    ].join("\n"),
    {
      invoiceId: z.string().uuid().describe("Invoice ID"),
    },
    async ({ invoiceId }) => {
      const data = await client.get(`/ar/invoices/${invoiceId}/attachments`);
      return textResult(data);
    },
    { title: "List Invoice Attachments", readOnlyHint: true },
  );
}
