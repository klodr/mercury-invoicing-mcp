import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createServer,
  resolveBaseUrl,
  SANDBOX_BASE_URL,
  VERSION,
} from "../src/server.js";

describe("resolveBaseUrl", () => {
  it("returns explicit baseUrl when provided", () => {
    expect(resolveBaseUrl("any-key", "https://custom.example.com/v1")).toBe(
      "https://custom.example.com/v1"
    );
  });

  it("returns sandbox URL for mercury_sandbox_ tokens", () => {
    expect(resolveBaseUrl("secret-token:mercury_sandbox_abc")).toBe(SANDBOX_BASE_URL);
  });

  it("returns undefined (= prod default) for production tokens", () => {
    expect(resolveBaseUrl("secret-token:mercury_production_abc")).toBeUndefined();
  });

  it("explicit baseUrl wins over sandbox auto-detection", () => {
    expect(
      resolveBaseUrl("secret-token:mercury_sandbox_abc", "https://override.example.com")
    ).toBe("https://override.example.com");
  });
});

describe("createServer", () => {
  it("creates a server that lists 32 tools", async () => {
    const server = createServer({ apiKey: "test-key", log: () => {} });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.length).toBe(32);

    await client.close();
  });

  it("logs sandbox detection when given a sandbox token (and no explicit baseUrl)", () => {
    const logs: string[] = [];
    createServer({
      apiKey: "secret-token:mercury_sandbox_abc",
      log: (m) => logs.push(m),
    });
    expect(logs.some((l) => l.includes("sandbox"))).toBe(true);
  });

  it("does NOT log sandbox when explicit baseUrl overrides", () => {
    const logs: string[] = [];
    createServer({
      apiKey: "secret-token:mercury_sandbox_abc",
      baseUrl: "https://my-proxy.example.com/v1",
      log: (m) => logs.push(m),
    });
    expect(logs.some((l) => l.includes("sandbox"))).toBe(false);
  });

  it("does NOT log sandbox for production tokens", () => {
    const logs: string[] = [];
    createServer({
      apiKey: "secret-token:mercury_production_abc",
      log: (m) => logs.push(m),
    });
    expect(logs.some((l) => l.includes("sandbox"))).toBe(false);
  });

  it("exposes the package VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
