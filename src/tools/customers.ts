import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

const addressSchema = z
  .object({
    name: z.string().describe("Recipient name on the address (e.g. customer name or contact)"),
    address1: z.string(),
    address2: z.string().optional(),
    city: z.string(),
    region: z.string().describe("State / region / province"),
    postalCode: z.string(),
    country: z.string().describe("ISO 3166-1 alpha-2 country code (e.g. 'US')"),
  })
  .describe("Customer billing address (Mercury requires `name` in the address)");

export function registerCustomerTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_customers",
    [
      "List Accounts Receivable customers, with cursor-based pagination.",
      "",
      "USE WHEN: enumerating AR customers before creating an invoice (need a `customerId` for `mercury_create_invoice`), or for a customer-level audit. Use `startAfter` / `endBefore` for paging beyond the limit.",
      "",
      "DO NOT USE: for payment recipients (`mercury_list_recipients` is the bank-payment counterparty list, distinct from AR customers). For one customer whose ID is known, prefer `mercury_get_customer`.",
      "",
      "RETURNS: `{ customers: [{ id, name, email, address, ... }] }`.",
    ].join("\n"),
    {
      limit: z.number().int().min(1).max(1000).optional().describe("Max results (1-1000)"),
      order: z.enum(["asc", "desc"]).optional(),
      startAfter: z.string().uuid().optional().describe("Pagination cursor (forward)"),
      endBefore: z.string().uuid().optional().describe("Pagination cursor (reverse)"),
    },
    async (args) => {
      const query: Record<string, string | number | undefined> = {
        limit: args.limit,
        order: args.order,
        start_after: args.startAfter,
        end_before: args.endBefore,
      };
      const data = await client.get("/ar/customers", query);
      return textResult(data);
    },
    { title: "List Customers", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_get_customer",
    [
      "Retrieve a specific Accounts Receivable customer by ID.",
      "",
      "USE WHEN: fetching the full detail of one customer whose ID is already known. Faster than relisting + filtering when you have the ID.",
      "",
      "DO NOT USE: to enumerate customers (use `mercury_list_customers`). For payment recipients use `mercury_list_recipients` (different surface).",
      "",
      "RETURNS: `{ id, name, email, address, ... }`.",
    ].join("\n"),
    {
      customerId: z.string().uuid().describe("Customer ID"),
    },
    async ({ customerId }) => {
      const data = await client.get(`/ar/customers/${customerId}`);
      return textResult(data);
    },
    { title: "Get Customer", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_create_customer",
    [
      "Create a new Accounts Receivable customer (a billable entity you will later invoice).",
      "",
      "USE WHEN: onboarding a new customer before issuing them an invoice. The returned `id` is what `mercury_create_invoice` expects as `customerId`.",
      "",
      "DO NOT USE: for payment recipients (use `mercury_add_recipient` — different surface, used for outbound bank transfers, not invoicing).",
      "",
      "SIDE EFFECTS: writes a new customer to your Mercury workspace. Persistent. NOT idempotent at the API level — calling twice with the same payload creates two customers; check `mercury_list_customers` for existing entries before creating to avoid duplicates.",
      "",
      "RETURNS: `{ id, name, email, address, ... }` — keep `id` for the invoicing tools.",
    ].join("\n"),
    {
      name: z.string().describe("Customer name"),
      email: z.string().email().describe("Customer email"),
      address: addressSchema.optional(),
    },
    async (args) => {
      const data = await client.post("/ar/customers", args);
      return textResult(data);
    },
    { title: "Create Customer", destructiveHint: false },
  );

  defineTool(
    server,
    "mercury_update_customer",
    [
      "Update an existing Accounts Receivable customer. Pass only the fields you want to change.",
      "",
      "USE WHEN: amending a customer's contact details (name, email, billing address) after creation. Existing invoices are not retroactively modified.",
      "",
      "DO NOT USE: to delete a customer (use `mercury_delete_customer`). To change the customer of an existing invoice, cancel + recreate the invoice.",
      "",
      "SIDE EFFECTS: writes the new customer record to Mercury. Persistent. Only the fields you pass are changed — omitted fields keep their current value.",
      "",
      "RETURNS: `{ id, name, email, address, ... }` — the updated customer.",
    ].join("\n"),
    {
      customerId: z.string().uuid().describe("Customer ID"),
      name: z.string().optional(),
      email: z.string().email().optional(),
      address: addressSchema.optional(),
    },
    async ({ customerId, ...body }) => {
      const data = await client.patch(`/ar/customers/${customerId}`, body);
      return textResult(data);
    },
    { title: "Update Customer", destructiveHint: false },
  );

  defineTool(
    server,
    "mercury_delete_customer",
    [
      "Permanently delete an Accounts Receivable customer. **DESTRUCTIVE.**",
      "",
      "USE WHEN: removing a customer that was created by mistake, or that the user explicitly wants to purge. ALWAYS confirm with the user before calling — there is no undo.",
      "",
      "DO NOT USE: when the customer has invoices in `paid` / `outstanding` status — Mercury rejects deletion in those cases and returns a 409. Cancel outstanding invoices first via `mercury_cancel_invoice`.",
      "",
      "SIDE EFFECTS: **permanent deletion** on Mercury's side. The customer disappears from the AR list. Past invoices' `customerId` may dangle (Mercury does not cascade-delete invoices). NOT recoverable from API. ALWAYS confirm with the user.",
      "",
      "RETURNS: confirmation payload from Mercury (`{ deleted: true, ... }` or similar).",
    ].join("\n"),
    {
      customerId: z.string().uuid().describe("Customer ID"),
    },
    async ({ customerId }) => {
      const data = await client.delete(`/ar/customers/${customerId}`);
      return textResult(data);
    },
    { title: "Delete Customer", destructiveHint: true },
  );
}
