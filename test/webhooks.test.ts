import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "../src/client.js";
import { registerWebhookTools } from "../src/tools/webhooks.js";

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

  it("rejects HTTPS URLs pointing at loopback / private / link-local IPs", async () => {
    const c = await connect();
    const bad = [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://169.254.169.254/latest/meta-data/", // AWS/GCP/Azure metadata
      "https://10.0.0.5/hook",
      "https://192.168.1.1/hook",
      "https://172.16.0.1/hook",
      "https://172.31.255.255/hook",
      "https://[::1]/hook",
      "https://[fc00::1]/hook",
      "https://[fe80::1]/hook",
    ];
    for (const u of bad) {
      const r = await c.callTool({
        name: "mercury_create_webhook",
        arguments: { url: u, events: ["invoice.paid"] },
      });
      expect(r.isError, `should have rejected ${u}`).toBe(true);
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
