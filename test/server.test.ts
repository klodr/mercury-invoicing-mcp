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
  // Most tests exercise non-Mercury hostnames; opt them in via the
  // explicit env-var so the validator's Mercury-only default doesn't
  // mask the property under test.
  beforeEach(() => {
    process.env.MERCURY_MCP_ALLOW_NON_MERCURY_HOST = "true";
  });
  afterEach(() => {
    delete process.env.MERCURY_MCP_ALLOW_NON_MERCURY_HOST;
  });

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

  // The user-facing error message is decoupled from `ipaddr.js`'s internal
  // taxonomy (uniqueLocal / carrierGradeNat / reserved / etc.). All non-public
  // ranges throw the same stable "non-public range" message; the raw
  // ipaddr.js label is logged to stderr for debug-level diagnosis instead.
  // Tests therefore match the stable substring rather than library labels.

  it("throws on RFC 1918 / link-local / cloud-metadata override", () => {
    expect(() => resolveBaseUrl("any-key", "https://10.0.0.5/api")).toThrow(/non-public range/);
    expect(() => resolveBaseUrl("any-key", "https://192.168.1.5/api")).toThrow(/non-public range/);
    expect(() => resolveBaseUrl("any-key", "https://172.16.0.5/api")).toThrow(/non-public range/);
    expect(() => resolveBaseUrl("any-key", "https://169.254.169.254/api")).toThrow(
      /non-public range/,
    );
  });

  it("throws on IPv6 ULA / link-local / loopback override", () => {
    expect(() => resolveBaseUrl("any-key", "https://[fc00::1]/api")).toThrow(/non-public range/);
    expect(() => resolveBaseUrl("any-key", "https://[fe80::1]/api")).toThrow(/non-public range/);
    expect(() => resolveBaseUrl("any-key", "https://[::1]/api")).toThrow(/non-public range/);
  });

  it("throws on IPv4-mapped IPv6 loopback in both encodings", () => {
    // ipaddr.js normalises both `::ffff:127.0.0.1` (dotted) and Node's
    // canonical `::ffff:7f00:1` (hex-pair) into the underlying IPv4 range.
    expect(() => resolveBaseUrl("any-key", "https://[::ffff:127.0.0.1]/api")).toThrow(
      /non-public range/,
    );
    expect(() => resolveBaseUrl("any-key", "https://[::ffff:7f00:1]/api")).toThrow(
      /non-public range/,
    );
  });

  it("throws on expanded IPv6 loopback form (0:0:0:0:0:0:0:1)", () => {
    expect(() => resolveBaseUrl("any-key", "https://[0:0:0:0:0:0:0:1]/api")).toThrow(
      /non-public range/,
    );
  });

  it("throws on RFC 6598 carrier-grade NAT (100.64/10) and RFC 2544 / 5737 reserved ranges", () => {
    expect(() => resolveBaseUrl("any-key", "https://100.64.0.5/api")).toThrow(/non-public range/);
    expect(() => resolveBaseUrl("any-key", "https://198.18.0.5/api")).toThrow(/non-public range/);
    expect(() => resolveBaseUrl("any-key", "https://192.0.2.5/api")).toThrow(/non-public range/);
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
  afterEach(() => {
    delete process.env.MERCURY_MCP_ALLOW_NON_MERCURY_HOST;
  });

  it("accepts the official Mercury production URL", () => {
    expect(() => validateBaseUrl("https://api.mercury.com/api/v1")).not.toThrow();
  });

  it("accepts the official Mercury sandbox URL", () => {
    expect(() => validateBaseUrl(SANDBOX_BASE_URL)).not.toThrow();
  });

  it("rejects other *.mercury.com subdomains by default (strict allowlist)", () => {
    // No wildcard: any future Mercury subdomain that should ship needs an
    // explicit code-review pass before it inherits write access to the
    // bearer token.
    expect(() => validateBaseUrl("https://internal.mercury.com/api/v1")).toThrow(
      /not a Mercury hostname/,
    );
    expect(() => validateBaseUrl("https://docs.mercury.com")).toThrow(/not a Mercury hostname/);
  });

  it("rejects non-Mercury hosts by default (no opt-in)", () => {
    expect(() => validateBaseUrl("https://attacker.example.com/api")).toThrow(
      /not a Mercury hostname/,
    );
    expect(() => validateBaseUrl("https://my-proxy.example.com/api")).toThrow(
      /not a Mercury hostname/,
    );
  });

  it("accepts non-Mercury hosts when MERCURY_MCP_ALLOW_NON_MERCURY_HOST=true", () => {
    process.env.MERCURY_MCP_ALLOW_NON_MERCURY_HOST = "true";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => validateBaseUrl("https://my-proxy.example.com/api")).not.toThrow();
      // Loud warning surfaced.
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("non-Mercury host"));
    } finally {
      errSpy.mockRestore();
    }
  });

  it("does NOT accept other truthy values for the opt-in (only the literal 'true')", () => {
    process.env.MERCURY_MCP_ALLOW_NON_MERCURY_HOST = "1";
    expect(() => validateBaseUrl("https://my-proxy.example.com/api")).toThrow(
      /not a Mercury hostname/,
    );
    process.env.MERCURY_MCP_ALLOW_NON_MERCURY_HOST = "yes";
    expect(() => validateBaseUrl("https://my-proxy.example.com/api")).toThrow(
      /not a Mercury hostname/,
    );
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
    process.env.MERCURY_MCP_ALLOW_NON_MERCURY_HOST = "true";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logs: string[] = [];
    try {
      createServer({
        apiKey: "secret-token:mercury_sandbox_abc",
        baseUrl: "https://my-proxy.example.com/v1",
        log: (m) => logs.push(m),
      });
      expect(logs.some((l) => l.includes("sandbox"))).toBe(false);
    } finally {
      errSpy.mockRestore();
      delete process.env.MERCURY_MCP_ALLOW_NON_MERCURY_HOST;
    }
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
