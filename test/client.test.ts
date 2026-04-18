import { MercuryClient, MercuryError } from "../src/client.js";

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function mockFetch(response: { ok: boolean; status: number; statusText?: string; body: unknown }) {
  global.fetch = jest.fn(async () => ({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText ?? (response.ok ? "OK" : "Error"),
    text: async () =>
      typeof response.body === "string" ? response.body : JSON.stringify(response.body),
  })) as unknown as typeof fetch;
}

describe("MercuryClient", () => {
  it("constructs with an API key", () => {
    const client = new MercuryClient({ apiKey: "test-key" });
    expect(client).toBeInstanceOf(MercuryClient);
  });

  it("uses custom base URL when provided", () => {
    const client = new MercuryClient({
      apiKey: "test-key",
      baseUrl: "https://custom.example.com/v1",
    });
    expect(client).toBeInstanceOf(MercuryClient);
  });

  it("GET request returns parsed JSON", async () => {
    mockFetch({ ok: true, status: 200, body: { accounts: [{ id: "acc_1" }] } });
    const client = new MercuryClient({ apiKey: "key" });
    const result = await client.get<{ accounts: { id: string }[] }>("/accounts");
    expect(result.accounts[0].id).toBe("acc_1");
  });

  it("GET request appends query params", async () => {
    let capturedUrl: string | undefined;
    global.fetch = (async (url: URL | string) => {
      capturedUrl = url.toString();
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "{}",
      };
    }) as unknown as typeof fetch;

    const client = new MercuryClient({ apiKey: "key" });
    await client.get("/transactions", { limit: 10, status: "sent" });

    expect(capturedUrl).toContain("limit=10");
    expect(capturedUrl).toContain("status=sent");
  });

  it("POST request sends JSON body and Authorization header", async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = (async (_url: URL | string, init?: RequestInit) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "{}",
      };
    }) as unknown as typeof fetch;

    const client = new MercuryClient({ apiKey: "secret-token:abc" });
    await client.post("/recipients", { name: "Acme" });

    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe(JSON.stringify({ name: "Acme" }));
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token:abc");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws MercuryError on non-2xx response", async () => {
    mockFetch({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      body: { message: "invalid token" },
    });
    const client = new MercuryClient({ apiKey: "bad-key" });
    await expect(client.get("/accounts")).rejects.toThrow(MercuryError);
    await expect(client.get("/accounts")).rejects.toMatchObject({
      status: 401,
      body: { message: "invalid token" },
    });
  });

  it("coerces empty response body to { ok: true }", async () => {
    mockFetch({ ok: true, status: 204, body: "" });
    const client = new MercuryClient({ apiKey: "key" });
    const result = await client.delete<{ ok: boolean }>("/ar/customers/abc");
    expect(result).toEqual({ ok: true });
  });

  it("falls back to raw text when the response body is not JSON", async () => {
    mockFetch({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      body: "<html><body>Bad gateway</body></html>",
    });
    const client = new MercuryClient({ apiKey: "k" });
    try {
      await client.get("/accounts");
      fail("Expected MercuryError");
    } catch (err) {
      expect(err).toBeInstanceOf(MercuryError);
      const e = err as MercuryError;
      expect(e.status).toBe(502);
      expect(e.body).toBe("<html><body>Bad gateway</body></html>");
    }
  });
});

describe("MercuryError", () => {
  it("captures status and body", () => {
    const err = new MercuryError("boom", 401, { message: "unauthorized" });
    expect(err.message).toBe("boom");
    expect(err.status).toBe(401);
    expect(err.body).toEqual({ message: "unauthorized" });
    expect(err.name).toBe("MercuryError");
  });

  it("toString does not leak the response body", () => {
    const err = new MercuryError("boom", 403, { secret: "abc123" });
    const str = err.toString();
    expect(str).toContain("MercuryError");
    expect(str).toContain("boom");
    expect(str).toContain("403");
    expect(str).not.toContain("abc123");
    expect(str).not.toContain("secret");
  });

  it("toJSON does not leak the response body", () => {
    const err = new MercuryError("boom", 500, { sensitive: "leak-me" });
    const json = err.toJSON() as Record<string, unknown>;
    expect(json).toEqual({ name: "MercuryError", message: "boom", status: 500 });
    expect(JSON.stringify(json)).not.toContain("leak-me");
  });

  it("body remains accessible on the property for callers that need it", () => {
    const err = new MercuryError("boom", 400, { field: "amount", reason: "missing" });
    expect(err.body).toEqual({ field: "amount", reason: "missing" });
  });
});
