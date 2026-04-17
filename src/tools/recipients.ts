import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerRecipientTools(server: McpServer, client: MercuryClient): void {
  server.tool(
    "mercury_list_recipients",
    "List all payment recipients in your Mercury workspace.",
    {},
    async () => {
      const data = await client.get("/recipients");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "mercury_add_recipient",
    "Add a new payment recipient. Requires read-write API token.",
    {
      name: z.string().describe("Recipient legal name"),
      emails: z.array(z.string().email()).describe("List of email addresses"),
      paymentMethod: z
        .enum(["domesticAch", "internationalWire", "domesticWire", "check"])
        .describe("Payment method to send to this recipient"),
      defaultPaymentMethod: z
        .enum(["domesticAch", "internationalWire", "domesticWire", "check"])
        .optional()
        .describe("Default payment method"),
      electronicRoutingInfo: z
        .object({
          accountNumber: z.string(),
          routingNumber: z.string(),
          electronicAccountType: z.enum(["businessChecking", "businessSavings", "personalChecking", "personalSavings"]),
          address: z
            .object({
              address1: z.string(),
              address2: z.string().optional(),
              city: z.string(),
              region: z.string(),
              postalCode: z.string(),
              country: z.string(),
            })
            .optional(),
        })
        .optional()
        .describe("Bank account info for ACH/wire"),
      idempotencyKey: z.string().optional().describe("Unique key to prevent duplicates"),
    },
    async ({ idempotencyKey, ...body }) => {
      const idem = idempotencyKey ?? crypto.randomUUID();
      const data = await client.post("/recipients", { ...body, idempotencyKey: idem });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
