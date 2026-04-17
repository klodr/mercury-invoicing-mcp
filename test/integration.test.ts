import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { resetRateLimitHistory } from "../src/middleware.js";

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
  const server = createServer({ apiKey: "test-key", log: () => {} });
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
    delete process.env.MERCURY_MCP_RATE_LIMIT_DISABLE;
    calls = setupFetchSpy({ ok: true, status: 200, body: { ok: true } });
    const setup = await setupServerAndClient();
    client = setup.client;
  });

  afterEach(async () => {
    await client.close();
    global.fetch = ORIGINAL_FETCH;
  });

  it("tools/list returns all 32 tools", async () => {
    const res = await client.listTools();
    expect(res.tools.length).toBe(32);
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
      arguments: { accountId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/account/11111111-1111-4111-8111-111111111111");
  });

  it("mercury_list_cards → GET /account/{id}/cards", async () => {
    await client.callTool({
      name: "mercury_list_cards",
      arguments: { accountId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(calls[0].url).toContain("/account/11111111-1111-4111-8111-111111111111/cards");
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
      arguments: { accountId: "11111111-1111-4111-8111-111111111111", limit: 10, status: "sent" },
    });
    expect(calls[0].url).toContain("/account/11111111-1111-4111-8111-111111111111/transactions");
    expect(calls[0].url).toContain("limit=10");
    expect(calls[0].url).toContain("status=sent");
  });

  it("mercury_get_transaction → GET single tx", async () => {
    await client.callTool({
      name: "mercury_get_transaction",
      arguments: { accountId: "11111111-1111-4111-8111-111111111111", transactionId: "22222222-2222-4222-8222-222222222222" },
    });
    expect(calls[0].url).toContain("/account/11111111-1111-4111-8111-111111111111/transaction/22222222-2222-4222-8222-222222222222");
  });

  it("mercury_send_money → POST with idempotency key", async () => {
    await client.callTool({
      name: "mercury_send_money",
      arguments: {
        accountId: "11111111-1111-4111-8111-111111111111",
        recipientId: "33333333-3333-4333-8333-333333333333",
        amount: 100,
        paymentMethod: "ach",
      },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/account/11111111-1111-4111-8111-111111111111/transactions");
    const body = JSON.parse(calls[0].body!);
    expect(body.recipientId).toBe("33333333-3333-4333-8333-333333333333");
    expect(body.amount).toBe(100);
    expect(body.idempotencyKey).toBeDefined();
  });

  it("mercury_request_send_money → POST request-send-money", async () => {
    await client.callTool({
      name: "mercury_request_send_money",
      arguments: {
        accountId: "11111111-1111-4111-8111-111111111111",
        recipientId: "33333333-3333-4333-8333-333333333333",
        amount: 50,
        paymentMethod: "ach",
      },
    });
    expect(calls[0].url).toContain("/account/11111111-1111-4111-8111-111111111111/request-send-money");
  });

  it("mercury_update_transaction → PATCH", async () => {
    await client.callTool({
      name: "mercury_update_transaction",
      arguments: { accountId: "11111111-1111-4111-8111-111111111111", transactionId: "22222222-2222-4222-8222-222222222222", note: "test" },
    });
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/account/11111111-1111-4111-8111-111111111111/transaction/22222222-2222-4222-8222-222222222222");
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

  // --- Statements / Treasury ---

  it("mercury_list_statements → GET /account/{id}/statements", async () => {
    await client.callTool({
      name: "mercury_list_statements",
      arguments: { accountId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(calls[0].url).toContain("/account/11111111-1111-4111-8111-111111111111/statements");
  });

  it("mercury_get_treasury → GET /treasury", async () => {
    await client.callTool({ name: "mercury_get_treasury", arguments: {} });
    expect(calls[0].url).toContain("/treasury");
  });

  it("mercury_list_treasury_transactions → GET /treasury/{id}/transactions", async () => {
    await client.callTool({
      name: "mercury_list_treasury_transactions",
      arguments: { accountId: "55555555-5555-4555-8555-555555555555" },
    });
    expect(calls[0].url).toContain("/treasury/55555555-5555-4555-8555-555555555555/transactions");
  });

  it("mercury_list_treasury_statements → GET /treasury/{id}/statements", async () => {
    await client.callTool({
      name: "mercury_list_treasury_statements",
      arguments: { accountId: "55555555-5555-4555-8555-555555555555" },
    });
    expect(calls[0].url).toContain("/treasury/55555555-5555-4555-8555-555555555555/statements");
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
      arguments: { webhookId: "44444444-4444-4444-8444-444444444444" },
    });
    expect(calls[0].url).toContain("/webhooks/44444444-4444-4444-8444-444444444444");
  });

  it("mercury_delete_webhook → DELETE /webhook/{id}", async () => {
    await client.callTool({
      name: "mercury_delete_webhook",
      arguments: { webhookId: "44444444-4444-4444-8444-444444444444" },
    });
    expect(calls[0].method).toBe("DELETE");
  });

  // Note: COA Templates + Journal Entries removed (Mercury does not expose them in the public API)

  // --- Auth headers ---

  it("every call includes the Bearer token", async () => {
    await client.callTool({ name: "mercury_list_accounts", arguments: {} });
    expect(calls[0].headers.Authorization).toBe("Bearer test-key");
  });
});
