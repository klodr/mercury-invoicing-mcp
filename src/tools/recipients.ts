import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerRecipientTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_recipients",
    [
      "List all payment recipients (counterparties for outbound ACH/wire/check) in your Mercury workspace.",
      "",
      "USE WHEN: enumerating recipients before sending money — need a `recipientId` to feed into `mercury_send_money` or `mercury_request_send_money`. Also useful for an audit of who can receive funds from this account.",
      "",
      "DO NOT USE: for AR customers (use `mercury_list_customers` — different surface, different scope). Recipients are bank-payment counterparties; customers are who you invoice.",
      "",
      "RETURNS: `{ recipients: [{ id, name, nickname, defaultPaymentMethod, electronicRoutingInfo, status, ... }] }`.",
    ].join("\n"),
    {},
    async () => {
      const data = await client.get("/recipients");
      return textResult(data);
    },
    { title: "List Recipients", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_update_recipient",
    [
      "Update an existing payment recipient (legal name, nickname, contact emails, default payment method).",
      "",
      "USE WHEN: amending a recipient's contact info or default payment method after creation. Useful for re-routing future payments to a recipient via a different method (e.g. ACH → wire) without recreating it.",
      "",
      "DO NOT USE: to change the bank account number / routing number — that requires a fresh recipient (security policy on Mercury's side). Use `mercury_add_recipient` for the new banking info.",
      "",
      "SIDE EFFECTS: writes the recipient record on Mercury. Persistent. Only the fields you pass are changed. Mercury endpoint is `POST /recipient/{id}` (SINGULAR — not the plural `/recipients/{id}`).",
      "",
      "RETURNS: `{ id, name, nickname, defaultPaymentMethod, ... }` — the updated recipient.",
    ].join("\n"),
    {
      recipientId: z.string().uuid().describe("The recipient ID"),
      name: z.string().optional().describe("Recipient legal name"),
      nickname: z.string().optional().describe("Internal nickname"),
      contactEmail: z.string().email().optional().describe("Primary contact email"),
      emails: z.array(z.string().email()).optional().describe("List of email addresses"),
      defaultPaymentMethod: z
        .enum(["domesticAch", "internationalWire", "domesticWire", "check"])
        .optional(),
    },
    async ({ recipientId, ...body }) => {
      const data = await client.post(`/recipient/${recipientId}`, body);
      return textResult(data);
    },
    { title: "Update Recipient", destructiveHint: false },
  );

  defineTool(
    server,
    "mercury_add_recipient",
    [
      "Add a new payment recipient (a counterparty you can later send money to via ACH/wire/check).",
      "",
      "USE WHEN: onboarding a new vendor, contractor, or other payee before sending money. The returned `id` is what `mercury_send_money` and `mercury_request_send_money` expect as `recipientId`.",
      "",
      "DO NOT USE: for AR customers (use `mercury_create_customer` — recipients receive money, customers pay invoices). Mercury enforces strict KYC/banking validation on bank fields — invalid routing numbers or account numbers are rejected at create time.",
      "",
      "SIDE EFFECTS: writes a new recipient to Mercury. Persistent. **Idempotent via `idempotencyKey`** — the MCP auto-generates one if not provided, so repeated calls with the same generated key would not duplicate; pass an explicit `idempotencyKey` to make this stable across retries you control.",
      "",
      "RETURNS: `{ id, name, status, defaultPaymentMethod, ... }` — keep `id` for the send-money tools.",
    ].join("\n"),
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
          electronicAccountType: z.enum([
            "businessChecking",
            "businessSavings",
            "personalChecking",
            "personalSavings",
          ]),
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
      const idem = idempotencyKey ?? randomUUID();
      const data = await client.post("/recipients", { ...body, idempotencyKey: idem });
      return textResult(data);
    },
    { title: "Add Recipient", destructiveHint: false, idempotentHint: true },
  );
}
