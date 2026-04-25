import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createServer,
  resolveBaseUrl,
  SANDBOX_BASE_URL,
  validateBaseUrl,
  VERSION,
} from "../src/server.js";

describe("resolveBaseUrl", () => {
  it("returns explicit baseUrl when provided", () => {
    expect(resolveBaseUrl("any-key", "https://custom.example.com/v1")).toBe(
      "https://custom.example.com/v1",
    );
  });

  it("returns sandbox URL for mercury_sandbox_ tokens", () => {
    expect(resolveBaseUrl("secret-token:mercury_sandbox_abc")).toBe(SANDBOX_BASE_URL);
  });

  it("returns undefined (= prod default) for production tokens", () => {
    expect(resolveBaseUrl("secret-token:mercury_production_abc")).toBeUndefined();
  });

  it("explicit baseUrl wins over sandbox auto-detection", () => {
    expect(resolveBaseUrl("secret-token:mercury_sandbox_abc", "https://override.example.com")).toBe(
      "https://override.example.com",
    );
  });

  it("throws on http:// override (no plaintext bearer leak)", () => {
    expect(() => resolveBaseUrl("any-key", "http://attacker.tld/api")).toThrow(/https:\/\//);
  });

  it("throws on loopback override (no SSRF)", () => {
    expect(() => resolveBaseUrl("any-key", "https://127.0.0.1/api")).toThrow(/publicly reachable/);
    expect(() => resolveBaseUrl("any-key", "https://localhost/api")).toThrow(/Loopback/);
  });

  it("rejects the full .localhost namespace (RFC 6761)", () => {
    // `localhost.` (trailing dot), `foo.localhost`, and `foo.localhost.`
    // are all reserved as loopback in RFC 6761 — sending a bearer to any
    // of them leaks the same way as `https://127.0.0.1/`.
    expect(() => resolveBaseUrl("any-key", "https://localhost./api")).toThrow(/Loopback/);
    expect(() => resolveBaseUrl("any-key", "https://foo.localhost/api")).toThrow(/Loopback/);
    expect(() => resolveBaseUrl("any-key", "https://foo.bar.localhost./api")).toThrow(/Loopback/);
  });

  it("throws on RFC 1918 / link-local / cloud-metadata override", () => {
    expect(() => resolveBaseUrl("any-key", "https://10.0.0.5/api")).toThrow(/publicly reachable/);
    expect(() => resolveBaseUrl("any-key", "https://192.168.1.5/api")).toThrow(
      /publicly reachable/,
    );
    expect(() => resolveBaseUrl("any-key", "https://172.16.0.5/api")).toThrow(/publicly reachable/);
    expect(() => resolveBaseUrl("any-key", "https://169.254.169.254/api")).toThrow(
      /publicly reachable/,
    );
  });

  it("throws on IPv6 ULA / link-local override", () => {
    expect(() => resolveBaseUrl("any-key", "https://[fc00::1]/api")).toThrow(/private IPv6/);
    expect(() => resolveBaseUrl("any-key", "https://[fe80::1]/api")).toThrow(/private IPv6/);
    expect(() => resolveBaseUrl("any-key", "https://[::1]/api")).toThrow(/Loopback/);
  });

  it("throws on IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)", () => {
    expect(() => resolveBaseUrl("any-key", "https://[::ffff:127.0.0.1]/api")).toThrow(
      /private IPv4/,
    );
  });

  it("throws on expanded IPv6 loopback form (0:0:0:0:0:0:0:1)", () => {
    expect(() => resolveBaseUrl("any-key", "https://[0:0:0:0:0:0:0:1]/api")).toThrow(/Loopback/);
  });

  it("does NOT misclassify DNS hostnames that contain hex-prefix substrings as IPv6", () => {
    // `fc00-proxy.example.com` is a perfectly valid DNS name — the previous
    // code wrongly rejected it because parseInt("fc00-proxy", 16) === 0xfc00
    // tripped the ULA bitmask. Bracketed-IPv6 gating fixes it.
    expect(() => resolveBaseUrl("any-key", "https://fc00-proxy.example.com/api")).not.toThrow();
    expect(() => resolveBaseUrl("any-key", "https://fe80-host.example.com/api")).not.toThrow();
  });

  it("treats empty string override as invalid (fail-closed)", () => {
    expect(() => resolveBaseUrl("any-key", "")).toThrow(/not a valid URL/);
  });

  it("throws on malformed override URL", () => {
    expect(() => resolveBaseUrl("any-key", "not-a-url")).toThrow(/not a valid URL/);
  });
});

describe("validateBaseUrl (direct)", () => {
  it("accepts the official Mercury production URL", () => {
    expect(() => validateBaseUrl("https://api.mercury.com/api/v1")).not.toThrow();
  });

  it("accepts the official Mercury sandbox URL", () => {
    expect(() => validateBaseUrl(SANDBOX_BASE_URL)).not.toThrow();
  });
});

describe("createServer", () => {
  it("creates a server that lists 36 tools", async () => {
    const server = createServer({ apiKey: "test-key", log: () => {} });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.length).toBe(36);

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

  it("falls back to console.error when no log option is given", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createServer({ apiKey: "secret-token:mercury_sandbox_test" });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("sandbox"));
  });
});
