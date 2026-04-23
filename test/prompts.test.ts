import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

/**
 * End-to-end tests for the `/mercury-*` slash-command prompts. The
 * prompt bodies name the `mercury_*` tools verbatim, so any tool
 * rename MUST keep the assertion intact — if this file breaks, the
 * prompt has drifted from the underlying tool API.
 */
describe("prompts: Mercury recipe slash commands", () => {
  async function connect() {
    const server = createServer({ apiKey: "test-key", log: () => {} });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
    return { client };
  }

  it("declares the `prompts` capability via registerPrompt", async () => {
    const { client } = await connect();
    const caps = client.getServerCapabilities();
    expect(caps?.prompts).toBeDefined();
  });

  it("exposes exactly the 7 documented slash commands", async () => {
    const { client } = await connect();
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual([
      "mercury-accounts-overview",
      "mercury-create-customer",
      "mercury-create-invoice",
      "mercury-create-recipient",
      "mercury-recipients-overview",
      "mercury-send-ach",
      "mercury-unpaid-invoices-overview",
    ]);
  });

  it("every prompt has a title and description", async () => {
    const { client } = await connect();
    const { prompts } = await client.listPrompts();
    for (const p of prompts) {
      expect(p.title, `title missing on ${p.name}`).toBeTruthy();
      expect(p.description, `description missing on ${p.name}`).toBeTruthy();
    }
  });

  describe("/mercury-send-ach", () => {
    it("declares the expected argument set", async () => {
      const { client } = await connect();
      const { prompts } = await client.listPrompts();
      const p = prompts.find((p) => p.name === "mercury-send-ach");
      const argNames = (p?.arguments ?? []).map((a) => a.name).sort();
      expect(argNames).toEqual(["amount", "externalMemo", "recipientHint", "sourceAccountHint"]);
      const required = (p?.arguments ?? [])
        .filter((a) => a.required)
        .map((a) => a.name)
        .sort();
      expect(required).toEqual(["amount", "recipientHint"]);
    });

    it("names the Mercury tools and walks through the confirmation gate", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-send-ach",
        arguments: {
          amount: "150.00",
          recipientHint: "Acme",
          sourceAccountHint: "Operating",
          externalMemo: "Invoice #123",
        },
      });
      expect(result.messages).toHaveLength(1);
      const msg = result.messages[0];
      expect(msg.role).toBe("user");
      expect(msg.content.type).toBe("text");
      const text = (msg.content as { text: string }).text;
      // Every tool called in the recipe must be named verbatim.
      expect(text).toContain("mercury_list_recipients");
      expect(text).toContain("mercury_list_accounts");
      expect(text).toContain("mercury_send_money");
      expect(text).toContain('paymentMethod: "ach"');
      // Recipe inputs must echo through into the instructions.
      expect(text).toContain("150.00");
      expect(text).toContain("Acme");
      expect(text).toContain("Operating");
      expect(text).toContain("Invoice #123");
      // Confirmation gate is load-bearing — irreversible transfer must
      // NEVER fire without a human ack.
      expect(text.toLowerCase()).toContain("confirm");
      expect(text).toContain("idempotencyKey");
    });

    it("skips the memo instruction when no memo is passed", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-send-ach",
        arguments: { amount: "25", recipientHint: "Bob" },
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).not.toContain("externalMemo:");
    });

    it("rejects externalMemo over 140 chars (Mercury API limit)", async () => {
      const { client } = await connect();
      await expect(
        client.getPrompt({
          name: "mercury-send-ach",
          arguments: { amount: "25", recipientHint: "Bob", externalMemo: "X".repeat(141) },
        }),
      ).rejects.toThrow();
    });

    it("accepts externalMemo up to 140 chars", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-send-ach",
        arguments: { amount: "25", recipientHint: "Bob", externalMemo: "X".repeat(140) },
      });
      expect(result.messages).toHaveLength(1);
    });

    it('rejects externalMemo with non-NACHA symbols (", ,, <, >, etc.)', async () => {
      const { client } = await connect();
      for (const bad of ['inv "123"', "inv, 123", "inv<tag>", "inv\\back"]) {
        await expect(
          client.getPrompt({
            name: "mercury-send-ach",
            arguments: { amount: "25", recipientHint: "Bob", externalMemo: bad },
          }),
          `expected "${bad}" to be rejected by the NACHA-allowed-symbols regex`,
        ).rejects.toThrow();
      }
    });

    it("accepts externalMemo with the full NACHA-allowed symbol set", async () => {
      const { client } = await connect();
      // Every symbol the NACHA spec permits, stitched together — must
      // pass. Includes a few alphanumerics to keep the memo realistic.
      const allowed = "Inv42 ()!#$%&'*+-./:;=?@[]^_{|}";
      const result = await client.getPrompt({
        name: "mercury-send-ach",
        arguments: { amount: "25", recipientHint: "Bob", externalMemo: allowed },
      });
      expect((result.messages[0].content as { text: string }).text).toContain(allowed);
    });

    it("rejects amount with more than 2 fractional digits or non-digits", async () => {
      const { client } = await connect();
      for (const bad of ["25.123", "abc", "25.", "-25", "25,00"]) {
        await expect(
          client.getPrompt({
            name: "mercury-send-ach",
            arguments: { amount: bad, recipientHint: "Bob" },
          }),
        ).rejects.toThrow();
      }
    });

    it("rejects zero-dollar amounts (minimum is 0.01)", async () => {
      const { client } = await connect();
      for (const zero of ["0", "0.00", "00", "0.0"]) {
        await expect(
          client.getPrompt({
            name: "mercury-send-ach",
            arguments: { amount: zero, recipientHint: "Bob" },
          }),
          `amount "${zero}" must be rejected as below 0.01 minimum`,
        ).rejects.toThrow();
      }
    });

    it("accepts 0.01 as the minimum valid amount", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-send-ach",
        arguments: { amount: "0.01", recipientHint: "Bob" },
      });
      expect((result.messages[0].content as { text: string }).text).toContain("0.01");
    });
  });

  describe("/mercury-create-recipient", () => {
    it("declares the expected argument set", async () => {
      const { client } = await connect();
      const { prompts } = await client.listPrompts();
      const p = prompts.find((p) => p.name === "mercury-create-recipient");
      const required = (p?.arguments ?? [])
        .filter((a) => a.required)
        .map((a) => a.name)
        .sort();
      expect(required).toEqual(["contactEmail", "name"]);
    });

    it("checks for duplicates before creating", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-create-recipient",
        arguments: {
          name: "Acme Corp",
          contactEmail: "ap@acme.test",
          routingNumber: "021000021",
          accountNumber: "123456789",
        },
      });
      const text = (result.messages[0].content as { text: string }).text;
      // Duplicate-check gate must run before the write tool is called.
      expect(text).toContain("mercury_list_recipients");
      expect(text).toContain("mercury_add_recipient");
      expect(text).toContain("Acme Corp");
      expect(text).toContain("ap@acme.test");
      // When routing + account are supplied, the prompt must wire
      // electronicRoutingInfo for ACH eligibility.
      expect(text).toContain("electronicRoutingInfo");
      expect(text).toContain("021000021");
      expect(text).toContain("123456789");
      expect(text).toContain('defaultPaymentMethod: "domesticAch"');
    });

    it("falls back to contact-only when bank details are absent", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-create-recipient",
        arguments: { name: "Contact Only Inc", contactEmail: "ap@example.test" },
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).not.toContain("electronicRoutingInfo");
      expect(text).toContain("contact-only");
    });

    it("includes the nickname line when nickname is supplied", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-create-recipient",
        arguments: {
          name: "Acme Corp",
          nickname: "Acme",
          contactEmail: "ap@acme.test",
        },
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain('nickname: "Acme"');
    });

    it("enforces ABA routing-number format (exactly 9 digits)", async () => {
      const { client } = await connect();
      for (const bad of ["12345678", "1234567890", "12345678a", "123 456 789"]) {
        await expect(
          client.getPrompt({
            name: "mercury-create-recipient",
            arguments: {
              name: "Acme",
              contactEmail: "a@b.c",
              routingNumber: bad,
              accountNumber: "12345678",
            },
          }),
          `routing "${bad}" should be rejected`,
        ).rejects.toThrow();
      }
    });

    it("enforces NACHA account-number width (4–17 digits)", async () => {
      const { client } = await connect();
      for (const bad of ["123", "12345678901234567890", "12345a678", ""]) {
        await expect(
          client.getPrompt({
            name: "mercury-create-recipient",
            arguments: {
              name: "Acme",
              contactEmail: "a@b.c",
              routingNumber: "021000021",
              accountNumber: bad,
            },
          }),
          `account "${bad}" should be rejected`,
        ).rejects.toThrow();
      }
    });
  });

  describe("/mercury-accounts-overview", () => {
    it("is read-only (no write tools named)", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-accounts-overview",
        arguments: {},
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain("mercury_list_accounts");
      // No write paths should be named — regression guard.
      for (const forbidden of [
        "mercury_send_money",
        "mercury_add_recipient",
        "mercury_update_recipient",
        "mercury_create_internal_transfer",
      ]) {
        expect(text, `${forbidden} should not appear in a read-only prompt`).not.toContain(
          forbidden,
        );
      }
    });

    it("filters closed accounts by default, keeps them when the flag is true", async () => {
      const { client } = await connect();
      const defaultRun = await client.getPrompt({
        name: "mercury-accounts-overview",
        arguments: {},
      });
      const defaultText = (defaultRun.messages[0].content as { text: string }).text;
      expect(defaultText).toContain("Filter out accounts");

      const includeClosed = await client.getPrompt({
        name: "mercury-accounts-overview",
        arguments: { includeClosedAccounts: "true" },
      });
      const includeText = (includeClosed.messages[0].content as { text: string }).text;
      expect(includeText).toContain("including closed ones");
    });
  });

  describe("/mercury-recipients-overview", () => {
    it("names list_recipients and is read-only", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-recipients-overview",
        arguments: {},
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain("mercury_list_recipients");
      expect(text.toLowerCase()).toContain("read-only");
      // Regression guard aligned with /mercury-accounts-overview so
      // both read-only overviews forbid the same write surface
      // (any drift would let a future edit accidentally pull a
      // write tool into a status-only prompt).
      for (const forbidden of [
        "mercury_send_money",
        "mercury_add_recipient",
        "mercury_update_recipient",
        "mercury_create_internal_transfer",
      ]) {
        expect(text, `${forbidden} should not appear in a read-only prompt`).not.toContain(
          forbidden,
        );
      }
    });

    it("surfaces the search filter when provided", async () => {
      const { client } = await connect();
      const result = await client.getPrompt({
        name: "mercury-recipients-overview",
        arguments: { search: "Acme" },
      });
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain("Acme");
      expect(text.toLowerCase()).toContain("filter");
    });
  });
});
