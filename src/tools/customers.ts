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
    "List AR customers, with cursor-based pagination.",
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
  );

  defineTool(
    server,
    "mercury_get_customer",
    "Retrieve a specific AR customer by ID.",
    {
      customerId: z.string().uuid().describe("Customer ID"),
    },
    async ({ customerId }) => {
      const data = await client.get(`/ar/customers/${customerId}`);
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_create_customer",
    "Create a new AR customer that you can later invoice.",
    {
      name: z.string().describe("Customer name"),
      email: z.string().email().describe("Customer email"),
      address: addressSchema.optional(),
    },
    async (args) => {
      const data = await client.post("/ar/customers", args);
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_update_customer",
    "Update an existing AR customer. Pass only the fields you want to change.",
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
  );

  defineTool(
    server,
    "mercury_delete_customer",
    "Permanently delete an AR customer.",
    {
      customerId: z.string().uuid().describe("Customer ID"),
    },
    async ({ customerId }) => {
      const data = await client.delete(`/ar/customers/${customerId}`);
      return textResult(data);
    },
  );
}
