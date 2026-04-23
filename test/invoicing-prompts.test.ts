import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

/**
 * End-to-end tests for the AR (invoicing) prompts. Invoicing is the
 * headline feature of this MCP, so the prompt bodies must name the
 * real `mercury_*` tools and enforce the same confirmation gates
 * the write tools have.
 */
describe("prompts: Mercury AR invoicing slash commands", () => {
  async function connect() {
    const server = createServer({ apiKey: "test-key", log: () => {} });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
    return { client };
  }

  describe("/mercury-create-customer", () => {
    it("declares name + email as required, address optional", async () => {
      const { client } = await connect();
      const { prompts } = await client.listPrompts();
      const p = prompts.find((p) => p.name === "mercury-create-customer");
      expect(p).toBeDefined();
      const required = (p?.arguments ?? [])
        .filter((a) => a.required)
        .map((a) => a.name)
        .sort();
      expect(required).toEqual(["email", "name"]);
    });

    it("checks for duplicates before creating and names the right tools", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-create-customer",
        arguments: { name: "Acme Corp", email: "billing@acme.test" },
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain("mercury_list_customers");
      expect(text).toContain("mercury_create_customer");
      expect(text).toContain("Acme Corp");
      expect(text).toContain("billing@acme.test");
      // Duplicate-check is load-bearing.
      expect(text.toLowerCase()).toContain("duplicate");
      // Must NOT chain into invoice creation — separate decision.
      expect(text).not.toContain("mercury_create_invoice");
    });

    it("prompts the user to parse the address when supplied", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-create-customer",
        arguments: {
          name: "Acme Corp",
          email: "billing@acme.test",
          // Commas are outside the NACHA allowlist and get stripped
          // by promptSafe — the slot preserves the other address
          // tokens, which is enough for the LLM to parse the parts.
          address: "123 Main St Austin TX 78701 USA",
        },
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain("123 Main St Austin TX 78701 USA");
      expect(text).toContain("postalCode");
    });
  });

  describe("/mercury-create-invoice", () => {
    it("declares the expected required args", async () => {
      const { client } = await connect();
      const { prompts } = await client.listPrompts();
      const p = prompts.find((p) => p.name === "mercury-create-invoice");
      const required = (p?.arguments ?? [])
        .filter((a) => a.required)
        .map((a) => a.name)
        .sort();
      expect(required).toEqual(["amount", "customerHint", "description"]);
    });

    it("chains list_customers → list_accounts → create_invoice with a confirmation gate", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-create-invoice",
        arguments: {
          customerHint: "Acme",
          depositAccountHint: "Operating",
          amount: "1250.00",
          description: "Consulting Q2",
          dueInDays: "45",
          invoiceNumber: "INV-2026-001",
        },
      });
      const text = (result.messages[0].content as { text: string }).text;
      // Sequence of tools.
      expect(text).toContain("mercury_list_customers");
      expect(text).toContain("mercury_list_accounts");
      expect(text).toContain("mercury_create_invoice");
      // Inputs echoed.
      expect(text).toContain("Acme");
      expect(text).toContain("Operating");
      expect(text).toContain("1250.00");
      expect(text).toContain("Consulting Q2");
      expect(text).toContain("45 days");
      expect(text).toContain("INV-2026-001");
      // SendNow default must be surfaced so the user knows the
      // invoice lands in the customer's inbox on confirmation.
      expect(text).toContain("SendNow");
      // Confirmation gate before the write tool.
      expect(text.toLowerCase()).toContain("confirm");
    });

    it("rejects dueInDays=0 and falls back to net-30", async () => {
      const { client } = await connect();

      const zero = await client.getPrompt({
        name: "mercury-create-invoice",
        arguments: {
          customerHint: "Bob",
          amount: "100",
          description: "One-off",
          dueInDays: "0",
        },
      });
      expect((zero.messages[0].content as { text: string }).text).toContain("30 days");

      const garbage = await client.getPrompt({
        name: "mercury-create-invoice",
        arguments: {
          customerHint: "Bob",
          amount: "100",
          description: "One-off",
          dueInDays: "soon",
        },
      });
      expect((garbage.messages[0].content as { text: string }).text).toContain("30 days");
    });

    it("omits optional invoiceNumber + poNumber lines when they are absent", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-create-invoice",
        arguments: {
          customerHint: "Acme",
          amount: "500",
          description: "Consulting",
        },
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).not.toContain("invoiceNumber:");
      expect(text).not.toContain("poNumber:");
    });
  });

  describe("/mercury-unpaid-invoices-overview", () => {
    it("declares only optional args (read-only report)", async () => {
      const { client } = await connect();
      const { prompts } = await client.listPrompts();
      const p = prompts.find((p) => p.name === "mercury-unpaid-invoices-overview");
      expect(p).toBeDefined();
      const required = (p?.arguments ?? []).filter((a) => a.required).map((a) => a.name);
      expect(required).toEqual([]);
    });

    it("is read-only (no write tools named) and explains the reminders gap", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-unpaid-invoices-overview",
        arguments: {},
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain("mercury_list_invoices");
      // No write paths.
      for (const forbidden of [
        "mercury_create_invoice",
        "mercury_update_invoice",
        "mercury_cancel_invoice",
        "mercury_send_money",
      ]) {
        expect(text, `${forbidden} should not appear in a read-only prompt`).not.toContain(
          forbidden,
        );
      }
      // Must point at the Mercury Dashboard for reminders (we cannot
      // send them via API yet — Dashboard-only toggle).
      expect(text).toContain("Mercury Dashboard");
    });

    it("surfaces the customer filter when provided", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-unpaid-invoices-overview",
        arguments: { customerHint: "Acme" },
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain("Acme");
      expect(text.toLowerCase()).toContain("scope");
    });
  });
});
