import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MercuryClient } from "../src/client.js";
import { registerAllTools } from "../src/tools/index.js";
import { wrapToolHandler, resetRateLimitHistory } from "../src/middleware.js";

interface FetchCall {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

/** Replace global fetch and capture every call. */
function setupFetchSpy(response: { ok: boolean; status: number; body: unknown }): FetchCall[] {
  const calls: FetchCall[] = [];
  global.fetch = (async (input: URL | string, init?: RequestInit) => {
    calls.push({
      url: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.ok ? "OK" : "Error",
      text: async () =>
        typeof response.body === "string" ? response.body : JSON.stringify(response.body),
    };
  }) as unknown as typeof fetch;
  return calls;
}

async function setupServerAndClient() {
  const mercury = new MercuryClient({ apiKey: "test-key" });
  const server = new McpServer({ name: "test", version: "0.0.0" });

  // Apply same middleware patch as in src/index.ts
  const originalTool = server.tool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (
    ...args: unknown[]
  ) => {
    const lastIdx = args.length - 1;
    if (typeof args[lastIdx] === "function" && typeof args[0] === "string") {
      args[lastIdx] = wrapToolHandler(
        args[0],
        args[lastIdx] as (a: unknown) => Promise<{
          content: { type: "text"; text: string }[];
          isError?: boolean;
        }>
      );
    }
    return originalTool(...args);
  };

  registerAllTools(server, mercury);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return { server, client };
}

const ORIGINAL_FETCH = global.fetch;

describe("Integration: every tool calls Mercury with the right endpoint", () => {
  let client: Client;
  let calls: FetchCall[];

  beforeEach(async () => {
    resetRateLimitHistory();
    delete process.env.MERCURY_MCP_DRY_RUN;
    delete process.env.MERCURY_MCP_RATE_LIMIT_disabled;
    calls = setupFetchSpy({ ok: true, status: 200, body: { ok: true } });
    const setup = await setupServerAndClient();
    client = setup.client;
  });

  afterEach(async () => {
    await client.close();
    global.fetch = ORIGINAL_FETCH;
  });

  it("tools/list returns all 45 tools", async () => {
    const res = await client.listTools();
    expect(res.tools.length).toBe(45);
  });

  // --- Banking accounts ---

  it("mercury_list_accounts → GET /accounts", async () => {
    await client.callTool({ name: "mercury_list_accounts", arguments: {} });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/accounts");
  });

  it("mercury_get_account → GET /account/{id}", async () => {
    await client.callTool({
      name: "mercury_get_account",
      arguments: { accountId: "acc_123" },
    });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/account/acc_123");
  });

  it("mercury_list_cards → GET /account/{id}/cards", async () => {
    await client.callTool({
      name: "mercury_list_cards",
      arguments: { accountId: "acc_123" },
    });
    expect(calls[0].url).toContain("/account/acc_123/cards");
  });

  it("mercury_list_categories → GET /categories", async () => {
    await client.callTool({ name: "mercury_list_categories", arguments: {} });
    expect(calls[0].url).toContain("/categories");
  });

  it("mercury_get_organization → GET /organization", async () => {
    await client.callTool({ name: "mercury_get_organization", arguments: {} });
    expect(calls[0].url).toContain("/organization");
  });

  // --- Transactions ---

  it("mercury_list_transactions → GET with query params", async () => {
    await client.callTool({
      name: "mercury_list_transactions",
      arguments: { accountId: "acc_1", limit: 10, status: "sent" },
    });
    expect(calls[0].url).toContain("/account/acc_1/transactions");
    expect(calls[0].url).toContain("limit=10");
    expect(calls[0].url).toContain("status=sent");
  });

  it("mercury_get_transaction → GET single tx", async () => {
    await client.callTool({
      name: "mercury_get_transaction",
      arguments: { accountId: "acc_1", transactionId: "tx_1" },
    });
    expect(calls[0].url).toContain("/account/acc_1/transaction/tx_1");
  });

  it("mercury_send_money → POST with idempotency key", async () => {
    await client.callTool({
      name: "mercury_send_money",
      arguments: {
        accountId: "acc_1",
        recipientId: "rec_1",
        amount: 100,
        paymentMethod: "ach",
      },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/account/acc_1/transactions");
    const body = JSON.parse(calls[0].body!);
    expect(body.recipientId).toBe("rec_1");
    expect(body.amount).toBe(100);
    expect(body.idempotencyKey).toBeDefined();
  });

  it("mercury_request_send_money → POST request-send-money", async () => {
    await client.callTool({
      name: "mercury_request_send_money",
      arguments: {
        accountId: "acc_1",
        recipientId: "rec_1",
        amount: 50,
        paymentMethod: "ach",
      },
    });
    expect(calls[0].url).toContain("/account/acc_1/request-send-money");
  });

  it("mercury_update_transaction → PATCH", async () => {
    await client.callTool({
      name: "mercury_update_transaction",
      arguments: { accountId: "acc_1", transactionId: "tx_1", note: "test" },
    });
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/account/acc_1/transaction/tx_1");
  });

  it("mercury_list_send_money_requests → GET", async () => {
    await client.callTool({
      name: "mercury_list_send_money_requests",
      arguments: { accountId: "acc_1" },
    });
    expect(calls[0].url).toContain("/account/acc_1/request-send-money");
  });

  // --- Recipients ---

  it("mercury_list_recipients → GET /recipients", async () => {
    await client.callTool({ name: "mercury_list_recipients", arguments: {} });
    expect(calls[0].url).toContain("/recipients");
  });

  it("mercury_add_recipient → POST /recipients", async () => {
    await client.callTool({
      name: "mercury_add_recipient",
      arguments: { name: "ACME", emails: ["a@b.com"], paymentMethod: "domesticAch" },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/recipients");
  });

  it("mercury_update_recipient → PATCH /recipient/{id}", async () => {
    await client.callTool({
      name: "mercury_update_recipient",
      arguments: { recipientId: "rec_1", name: "Updated" },
    });
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/recipient/rec_1");
  });

  // --- Statements / Treasury ---

  it("mercury_list_statements → GET /account/{id}/statements", async () => {
    await client.callTool({
      name: "mercury_list_statements",
      arguments: { accountId: "acc_1" },
    });
    expect(calls[0].url).toContain("/account/acc_1/statements");
  });

  it("mercury_get_treasury → GET /treasury", async () => {
    await client.callTool({ name: "mercury_get_treasury", arguments: {} });
    expect(calls[0].url).toContain("/treasury");
  });

  it("mercury_list_treasury_transactions → GET /treasury/{id}/transactions", async () => {
    await client.callTool({
      name: "mercury_list_treasury_transactions",
      arguments: { accountId: "tr_1" },
    });
    expect(calls[0].url).toContain("/treasury/tr_1/transactions");
  });

  it("mercury_list_treasury_statements → GET /treasury/{id}/statements", async () => {
    await client.callTool({
      name: "mercury_list_treasury_statements",
      arguments: { accountId: "tr_1" },
    });
    expect(calls[0].url).toContain("/treasury/tr_1/statements");
  });

  // --- Invoices ---

  it("mercury_list_invoices → GET /ar/invoices", async () => {
    await client.callTool({ name: "mercury_list_invoices", arguments: {} });
    expect(calls[0].url).toContain("/ar/invoices");
  });

  it("mercury_get_invoice → GET /ar/invoices/{id}", async () => {
    await client.callTool({
      name: "mercury_get_invoice",
      arguments: { invoiceId: "00000000-0000-0000-0000-000000000001" },
    });
    expect(calls[0].url).toContain("/ar/invoices/00000000-0000-0000-0000-000000000001");
  });

  it("mercury_create_invoice → POST /ar/invoices with body", async () => {
    await client.callTool({
      name: "mercury_create_invoice",
      arguments: {
        customerId: "00000000-0000-0000-0000-000000000001",
        destinationAccountId: "00000000-0000-0000-0000-000000000002",
        invoiceDate: "2026-04-17",
        dueDate: "2026-05-17",
        lineItems: [{ description: "Test", quantity: 1, unitPrice: 10 }],
      },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/ar/invoices");
    const body = JSON.parse(calls[0].body!);
    expect(body.lineItems[0].unitPrice).toBe(10);
    expect(body.achDebitEnabled).toBe(true);
    expect(body.creditCardEnabled).toBe(true);
  });

  it("mercury_update_invoice → PATCH /ar/invoices/{id}", async () => {
    await client.callTool({
      name: "mercury_update_invoice",
      arguments: {
        invoiceId: "00000000-0000-0000-0000-000000000001",
        dueDate: "2026-06-01",
      },
    });
    expect(calls[0].method).toBe("PATCH");
  });

  it("mercury_send_invoice → POST /ar/invoices/{id}/send", async () => {
    await client.callTool({
      name: "mercury_send_invoice",
      arguments: { invoiceId: "00000000-0000-0000-0000-000000000001" },
    });
    expect(calls[0].url).toContain("/send");
  });

  it("mercury_cancel_invoice → POST /ar/invoices/{id}/cancel", async () => {
    await client.callTool({
      name: "mercury_cancel_invoice",
      arguments: { invoiceId: "00000000-0000-0000-0000-000000000001" },
    });
    expect(calls[0].url).toContain("/cancel");
  });

  it("mercury_list_invoice_attachments → GET /ar/invoices/{id}/attachments", async () => {
    await client.callTool({
      name: "mercury_list_invoice_attachments",
      arguments: { invoiceId: "00000000-0000-0000-0000-000000000001" },
    });
    expect(calls[0].url).toContain("/attachments");
  });

  // --- Customers ---

  it("mercury_list_customers → GET /ar/customers", async () => {
    await client.callTool({ name: "mercury_list_customers", arguments: {} });
    expect(calls[0].url).toContain("/ar/customers");
  });

  it("mercury_get_customer → GET /ar/customers/{id}", async () => {
    await client.callTool({
      name: "mercury_get_customer",
      arguments: { customerId: "00000000-0000-0000-0000-000000000001" },
    });
    expect(calls[0].url).toContain("/ar/customers/00000000-0000-0000-0000-000000000001");
  });

  it("mercury_create_customer → POST /ar/customers", async () => {
    await client.callTool({
      name: "mercury_create_customer",
      arguments: { name: "ACME", email: "a@b.com" },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/ar/customers");
  });

  it("mercury_update_customer → PATCH /ar/customers/{id}", async () => {
    await client.callTool({
      name: "mercury_update_customer",
      arguments: { customerId: "00000000-0000-0000-0000-000000000001", name: "New" },
    });
    expect(calls[0].method).toBe("PATCH");
  });

  it("mercury_delete_customer → DELETE /ar/customers/{id}", async () => {
    await client.callTool({
      name: "mercury_delete_customer",
      arguments: { customerId: "00000000-0000-0000-0000-000000000001" },
    });
    expect(calls[0].method).toBe("DELETE");
  });

  // --- Webhooks ---

  it("mercury_list_webhooks → GET /webhooks", async () => {
    await client.callTool({ name: "mercury_list_webhooks", arguments: {} });
    expect(calls[0].url).toContain("/webhooks");
  });

  it("mercury_create_webhook → POST /webhooks", async () => {
    await client.callTool({
      name: "mercury_create_webhook",
      arguments: { url: "https://example.com/wh", events: ["invoice.paid"] },
    });
    expect(calls[0].method).toBe("POST");
  });

  it("mercury_get_webhook → GET /webhook/{id}", async () => {
    await client.callTool({
      name: "mercury_get_webhook",
      arguments: { webhookId: "wh_1" },
    });
    expect(calls[0].url).toContain("/webhook/wh_1");
  });

  it("mercury_update_webhook → PATCH /webhook/{id}", async () => {
    await client.callTool({
      name: "mercury_update_webhook",
      arguments: { webhookId: "wh_1", url: "https://new.example.com" },
    });
    expect(calls[0].method).toBe("PATCH");
  });

  it("mercury_delete_webhook → DELETE /webhook/{id}", async () => {
    await client.callTool({
      name: "mercury_delete_webhook",
      arguments: { webhookId: "wh_1" },
    });
    expect(calls[0].method).toBe("DELETE");
  });

  // --- COA Templates ---

  it("mercury_list_coa_templates → GET /coa-templates", async () => {
    await client.callTool({ name: "mercury_list_coa_templates", arguments: {} });
    expect(calls[0].url).toContain("/coa-templates");
  });

  it("mercury_get_coa_template → GET /coa-template/{id}", async () => {
    await client.callTool({
      name: "mercury_get_coa_template",
      arguments: { templateId: "tpl_1" },
    });
    expect(calls[0].url).toContain("/coa-template/tpl_1");
  });

  it("mercury_create_coa_template → POST /coa-templates", async () => {
    await client.callTool({
      name: "mercury_create_coa_template",
      arguments: { name: "Standard", accounts: [{ code: "1000", name: "Cash", type: "asset" }] },
    });
    expect(calls[0].method).toBe("POST");
  });

  it("mercury_update_coa_template → PATCH /coa-template/{id}", async () => {
    await client.callTool({
      name: "mercury_update_coa_template",
      arguments: { templateId: "tpl_1", name: "Updated" },
    });
    expect(calls[0].method).toBe("PATCH");
  });

  it("mercury_delete_coa_template → DELETE /coa-template/{id}", async () => {
    await client.callTool({
      name: "mercury_delete_coa_template",
      arguments: { templateId: "tpl_1" },
    });
    expect(calls[0].method).toBe("DELETE");
  });

  // --- Journal Entries ---

  it("mercury_list_journal_entries → GET /journal-entries", async () => {
    await client.callTool({ name: "mercury_list_journal_entries", arguments: {} });
    expect(calls[0].url).toContain("/journal-entries");
  });

  it("mercury_get_journal_entry → GET /journal-entry/{id}", async () => {
    await client.callTool({
      name: "mercury_get_journal_entry",
      arguments: { entryId: "je_1" },
    });
    expect(calls[0].url).toContain("/journal-entry/je_1");
  });

  it("mercury_create_journal_entry → POST /journal-entries", async () => {
    await client.callTool({
      name: "mercury_create_journal_entry",
      arguments: {
        date: "2026-04-17",
        lines: [
          { accountCode: "1000", debit: 100 },
          { accountCode: "4000", credit: 100 },
        ],
      },
    });
    expect(calls[0].method).toBe("POST");
  });

  it("mercury_update_journal_entry → PATCH /journal-entry/{id}", async () => {
    await client.callTool({
      name: "mercury_update_journal_entry",
      arguments: { entryId: "je_1", memo: "Updated" },
    });
    expect(calls[0].method).toBe("PATCH");
  });

  it("mercury_delete_journal_entry → DELETE /journal-entry/{id}", async () => {
    await client.callTool({
      name: "mercury_delete_journal_entry",
      arguments: { entryId: "je_1" },
    });
    expect(calls[0].method).toBe("DELETE");
  });

  // --- Auth headers ---

  it("every call includes the Bearer token", async () => {
    await client.callTool({ name: "mercury_list_accounts", arguments: {} });
    expect(calls[0].headers.Authorization).toBe("Bearer test-key");
  });
});
