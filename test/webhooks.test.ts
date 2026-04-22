import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "../src/client.js";
import { registerWebhookTools } from "../src/tools/webhooks.js";

// Mock `fetch` globally so the non-validation test cases (schema passes →
// MercuryClient issues a request) return a deterministic stub response
// instead of actually reaching api.mercury.com and failing on a fake
// API key. Keeps the suite network-independent and fast.
//
// Also disable the local rate limiter: the CIDR-adjacency case loops
// through six public IPs and the `webhooks_create` bucket is only 2/day,
// so without this toggle the 3rd call would see `mcp_rate_limit_daily_exceeded`
// instead of reaching the 401 stub that proves validation actually passed.
beforeEach(() => {
  process.env.MERCURY_MCP_RATE_LIMIT_DISABLE = "true";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  delete process.env.MERCURY_MCP_RATE_LIMIT_DISABLE;
  vi.unstubAllGlobals();
});

/**
 * End-to-end guard against the "webhook URL accepts http://" finding.
 * Exercises the Zod schema through the MCP wire so a refactor that
 * relocates the validator can still be caught.
 */
async function connect() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = new MercuryClient({ apiKey: "test-key-not-used-in-validation-path" });
  registerWebhookTools(server, client);

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([mcpClient.connect(clientT), server.connect(serverT)]);
  return mcpClient;
}

describe("mercury_create_webhook — URL validation", () => {
  it("rejects http:// URLs", async () => {
    const c = await connect();
    const r = await c.callTool({
      name: "mercury_create_webhook",
      arguments: { url: "http://example.com/hook", events: ["invoice.paid"] },
    });
    expect(r.isError).toBe(true);
    const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text.toLowerCase()).toMatch(/https/);
  });

  it("rejects file:// URLs", async () => {
    const c = await connect();
    const r = await c.callTool({
      name: "mercury_create_webhook",
      arguments: { url: "file:///etc/passwd", events: ["invoice.paid"] },
    });
    expect(r.isError).toBe(true);
  });

  it("rejects data: and ftp: schemes", async () => {
    const c = await connect();
    for (const bad of ["data:text/plain,payload", "ftp://example.com/hook"]) {
      const r = await c.callTool({
        name: "mercury_create_webhook",
        arguments: { url: bad, events: ["invoice.paid"] },
      });
      expect(r.isError).toBe(true);
    }
  });

  it("rejects HTTPS URLs pointing at loopback / private / link-local IPs (full CIDR ranges)", async () => {
    const c = await connect();
    const bad = [
      "https://localhost/hook",
      // 127.0.0.0/8 — full loopback range, not just 127.0.0.1
      "https://127.0.0.1/hook",
      "https://127.0.0.2/hook",
      "https://127.1.2.3/hook",
      // 10.0.0.0/8
      "https://10.0.0.5/hook",
      "https://10.255.255.255/hook",
      // 169.254.0.0/16 — link-local + AWS/GCP/Azure metadata
      "https://169.254.169.254/latest/meta-data/",
      "https://169.254.0.1/hook",
      // 192.168.0.0/16
      "https://192.168.1.1/hook",
      // 172.16.0.0/12 (172.16.x.x – 172.31.x.x)
      "https://172.16.0.1/hook",
      "https://172.31.255.255/hook",
      // IPv6 loopback + ULA (fc00::/7: fc.. + fd..) + link-local (fe80::/10: fe80 – febf)
      "https://[::1]/hook",
      "https://[fc00::1]/hook",
      "https://[fd00::1]/hook",
      "https://[fe80::1]/hook",
      "https://[fe90::1]/hook", // still inside fe80::/10 — the old startsWith("fe80:") missed this
      "https://[febf:ffff::1]/hook", // last /16 inside fe80::/10
    ];
    for (const u of bad) {
      const r = await c.callTool({
        name: "mercury_create_webhook",
        arguments: { url: u, events: ["invoice.paid"] },
      });
      expect(r.isError, `should have rejected ${u}`).toBe(true);
    }
  });

  it("accepts IPv4 addresses adjacent to but outside the blocked CIDR ranges", async () => {
    const c = await connect();
    // These are publicly routable and must NOT trip the private-IP filter.
    // Schema passes → request reaches Mercury → fails on fake API key
    // (expected; the point is that the schema let it through).
    const good = [
      "https://128.0.0.1/hook", //     next /8 after 127
      "https://11.0.0.1/hook", //      next /8 after 10
      "https://172.15.255.255/hook", // 172.15.x.x is public (12-block starts at .16)
      "https://172.32.0.1/hook", //    172.32.x.x is public (12-block ends at .31)
      "https://192.167.1.1/hook", //   just below 192.168
      "https://169.253.0.1/hook", //   just below 169.254
    ];
    for (const u of good) {
      const r = await c.callTool({
        name: "mercury_create_webhook",
        arguments: { url: u, events: ["invoice.paid"] },
      });
      // If the schema wrongly rejected these, the error would mention
      // "publicly reachable" or "must use https" — assert it does NOT.
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
      expect(text.toLowerCase(), `should have accepted ${u}`).not.toContain("publicly reachable");
      expect(text.toLowerCase(), `should have accepted ${u}`).not.toContain("must use https");
      // Positive assertion: schema passed → MercuryClient was called and
      // failed on the 401 stub, proving we actually reached the downstream
      // path instead of short-circuiting on a false-negative validation pass.
      expect(text, `should have reached downstream for ${u}`).toContain("401");
    }
  });

  it("accepts HTTPS URLs pointing at public hostnames (validation passes; downstream API call fails on the fake key, which is expected)", async () => {
    const c = await connect();
    const r = await c.callTool({
      name: "mercury_create_webhook",
      arguments: { url: "https://hooks.example.com/mercury", events: ["invoice.paid"] },
    });
    // Validation passed → control reached the Mercury client, which fails
    // with an auth error on the fake API key. The key point: the error is
    // an upstream Mercury one, not a Zod schema rejection.
    const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text.toLowerCase()).not.toContain("https://");
    expect(text.toLowerCase()).not.toContain("publicly reachable");
  });
});

describe("mercury_update_webhook — URL validation (same rules)", () => {
  it("rejects http:// on update too", async () => {
    const c = await connect();
    const r = await c.callTool({
      name: "mercury_update_webhook",
      arguments: {
        webhookId: "00000000-0000-4000-8000-000000000000",
        url: "http://example.com/hook",
      },
    });
    expect(r.isError).toBe(true);
  });

  it("rejects metadata IPs on update too", async () => {
    const c = await connect();
    const r = await c.callTool({
      name: "mercury_update_webhook",
      arguments: {
        webhookId: "00000000-0000-4000-8000-000000000000",
        url: "https://169.254.169.254/latest/meta-data/",
      },
    });
    expect(r.isError).toBe(true);
  });

  it("update without url arg still works (url is optional)", async () => {
    const c = await connect();
    const r = await c.callTool({
      name: "mercury_update_webhook",
      arguments: {
        webhookId: "00000000-0000-4000-8000-000000000000",
        status: "paused",
      },
    });
    // Validation passed; downstream API call will fail (fake key) but not on schema.
    const text = (r.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text.toLowerCase()).not.toContain("https://");
  });
});
