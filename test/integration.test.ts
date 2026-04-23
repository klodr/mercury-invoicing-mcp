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

  it("tools/list returns all 36 tools", async () => {
    const res = await client.listTools();
    expect(res.tools.length).toBe(36);
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

  it("mercury_list_credit_accounts → GET /credit (undocumented endpoint)", async () => {
    await client.callTool({ name: "mercury_list_credit_accounts", arguments: {} });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/credit");
    // Must not hit the documented `/accounts` path — that filter out
    // the IO Credit account server-side.
    expect(calls[0].url).not.toMatch(/\/accounts(\?|$)/);
  });

  it("mercury_list_credit_transactions → GET /account/{id}/transactions (singular path)", async () => {
    await client.callTool({
      name: "mercury_list_credit_transactions",
      arguments: {
        accountId: "22222222-2222-4222-8222-222222222222",
        status: "pending",
      },
    });
    expect(calls[0].method).toBe("GET");
    // Singular `/account/{id}/transactions` is distinct from the
    // documented plural `/accounts/{id}/transactions` — the
    // singular route is what routes IO Credit transactions.
    expect(calls[0].url).toContain("/account/22222222-2222-4222-8222-222222222222/transactions");
    expect(calls[0].url).toContain("status=pending");
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
      arguments: {
        accountId: "11111111-1111-4111-8111-111111111111",
        transactionId: "22222222-2222-4222-8222-222222222222",
      },
    });
    expect(calls[0].url).toContain(
      "/account/11111111-1111-4111-8111-111111111111/transaction/22222222-2222-4222-8222-222222222222",
    );
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
    expect(calls[0].url).toContain(
      "/account/11111111-1111-4111-8111-111111111111/request-send-money",
    );
  });

  it("mercury_update_transaction → PATCH /transaction/{id} (no accountId)", async () => {
    await client.callTool({
      name: "mercury_update_transaction",
      arguments: { transactionId: "22222222-2222-4222-8222-222222222222", note: "test" },
    });
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/transaction/22222222-2222-4222-8222-222222222222");
    expect(calls[0].url).not.toContain("/account/");
  });

  it("mercury_create_internal_transfer → POST /transfer with idempotency key", async () => {
    await client.callTool({
      name: "mercury_create_internal_transfer",
      arguments: {
        sourceAccountId: "11111111-1111-4111-8111-111111111111",
        destinationAccountId: "55555555-5555-4555-8555-555555555555",
        amount: 100,
        note: "Move savings",
      },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/transfer");
    const body = JSON.parse(calls[0].body!);
    expect(body.amount).toBe(100);
    expect(body.idempotencyKey).toBeDefined();
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

  it("mercury_update_recipient → POST /recipient/{id} (singular)", async () => {
    await client.callTool({
      name: "mercury_update_recipient",
      arguments: {
        recipientId: "33333333-3333-4333-8333-333333333333",
        nickname: "Updated nickname",
      },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/recipient/33333333-3333-4333-8333-333333333333");
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
      arguments: { invoiceId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(calls[0].url).toContain("/ar/invoices/00000000-0000-4000-8000-000000000001");
  });

  it("mercury_create_invoice → POST /ar/invoices with body", async () => {
    await client.callTool({
      name: "mercury_create_invoice",
      arguments: {
        customerId: "00000000-0000-4000-8000-000000000001",
        destinationAccountId: "00000000-0000-4000-8000-000000000002",
        invoiceDate: "2026-04-17",
        dueDate: "2026-05-17",
        lineItems: [{ name: "Test", quantity: 1, unitPrice: 10 }],
      },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/ar/invoices");
    const body = JSON.parse(calls[0].body!);
    expect(body.lineItems[0].unitPrice).toBe(10);
    expect(body.achDebitEnabled).toBe(true);
    expect(body.creditCardEnabled).toBe(true);
  });

  it("mercury_update_invoice → GET then POST /ar/invoices/{id} with merged payload", async () => {
    // Override the fetch spy with a sequence: GET returns current invoice, POST returns updated
    let callNum = 0;
    const localCalls: { url: string; method: string; body?: string }[] = [];
    global.fetch = (async (input: URL | string, init?: RequestInit) => {
      callNum += 1;
      localCalls.push({
        url: input.toString(),
        method: init?.method ?? "GET",
        body: init?.body as string | undefined,
      });
      const responseBody =
        callNum === 1
          ? {
              id: "00000000-0000-4000-8000-000000000001",
              invoiceDate: "2026-04-01",
              dueDate: "2026-04-15",
              invoiceNumber: "INV-99",
              payerMemo: "old memo",
              customerId: "cust-1",
              destinationAccountId: "acct-1",
              ccEmails: [],
              status: "Unpaid",
              amount: 100,
              slug: "abc",
              createdAt: "2026-04-01T00:00:00Z",
              updatedAt: "2026-04-01T00:00:00Z",
              achDebitEnabled: false,
              creditCardEnabled: false,
              useRealAccountNumber: false,
              lineItems: [{ name: "Old", unitPrice: 100, quantity: 1 }],
            }
          : { ok: true };
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(responseBody),
      };
    }) as unknown as typeof fetch;

    await client.callTool({
      name: "mercury_update_invoice",
      arguments: {
        invoiceId: "00000000-0000-4000-8000-000000000001",
        dueDate: "2026-06-01",
      },
    });

    expect(localCalls).toHaveLength(2);
    expect(localCalls[0].method).toBe("GET");
    expect(localCalls[1].method).toBe("POST");
    expect(localCalls[1].url).toContain("/ar/invoices/00000000-0000-4000-8000-000000000001");
    const body = JSON.parse(localCalls[1].body!);
    expect(body.dueDate).toBe("2026-06-01"); // changed
    expect(body.invoiceNumber).toBe("INV-99"); // preserved
    expect(body.payerMemo).toBe("old memo"); // preserved
    expect(body.id).toBeUndefined(); // read-only stripped
    expect(body.slug).toBeUndefined();
    expect(body.status).toBeUndefined();
    expect(body.amount).toBeUndefined();
  });

  it("mercury_cancel_invoice → POST /ar/invoices/{id}/cancel", async () => {
    await client.callTool({
      name: "mercury_cancel_invoice",
      arguments: { invoiceId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(calls[0].url).toContain("/cancel");
  });

  it("mercury_list_invoice_attachments → GET /ar/invoices/{id}/attachments", async () => {
    await client.callTool({
      name: "mercury_list_invoice_attachments",
      arguments: { invoiceId: "00000000-0000-4000-8000-000000000001" },
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
      arguments: { customerId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(calls[0].url).toContain("/ar/customers/00000000-0000-4000-8000-000000000001");
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
      arguments: { customerId: "00000000-0000-4000-8000-000000000001", name: "New" },
    });
    expect(calls[0].method).toBe("PATCH");
  });

  it("mercury_delete_customer → DELETE /ar/customers/{id}", async () => {
    await client.callTool({
      name: "mercury_delete_customer",
      arguments: { customerId: "00000000-0000-4000-8000-000000000001" },
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

  it("mercury_update_webhook → POST /webhooks/{id}", async () => {
    await client.callTool({
      name: "mercury_update_webhook",
      arguments: {
        webhookId: "44444444-4444-4444-8444-444444444444",
        status: "paused",
      },
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/webhooks/44444444-4444-4444-8444-444444444444");
    const body = JSON.parse(calls[0].body!);
    expect(body.status).toBe("paused");
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

  // --- SEC-004: strict ISO date validation on YYYY-MM-DD inputs ---

  it("rejects an invalid YYYY-MM-DD date and never reaches Mercury", async () => {
    const res = await client.callTool({
      name: "mercury_create_invoice",
      arguments: {
        customerId: "00000000-0000-4000-8000-000000000001",
        destinationAccountId: "00000000-0000-4000-8000-000000000002",
        invoiceDate: "2026-4-17", // single-digit month — rejected by z.iso.date()
        dueDate: "2026-05-17",
        lineItems: [{ name: "Test", quantity: 1, unitPrice: 10 }],
      },
    });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-date string and never reaches Mercury", async () => {
    const res = await client.callTool({
      name: "mercury_list_transactions",
      arguments: {
        accountId: "00000000-0000-4000-8000-000000000001",
        start: "yesterday",
      },
    });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("accepts a valid YYYY-MM-DD date (regression after SEC-004 tightening)", async () => {
    await client.callTool({
      name: "mercury_list_transactions",
      arguments: {
        accountId: "00000000-0000-4000-8000-000000000001",
        start: "2026-01-01",
        end: "2026-04-19",
      },
    });
    expect(calls[0].url).toContain("start=2026-01-01");
    expect(calls[0].url).toContain("end=2026-04-19");
  });
});
