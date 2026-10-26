import { afterEach, describe, expect, it, vi } from "vitest";

// The guard resolves every hostname: answer with whatever each test needs.
const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));

import { assertSafeUrl, describeTrustedCidrs, parseTrustedCidrs } from "../src/safe-url.js";
import { createServer } from "../src/server.js";
const API = "https://api.mercury.com/api/v1/accounts";
const asText = (raw: string): string[] =>
  parseTrustedCidrs(raw).map(([addr, bits]) => `${addr.toString()}/${bits}`);

afterEach(() => {
  delete process.env.MCP_TRUSTED_CIDRS;
  lookup.mockReset();
});

describe("parseTrustedCidrs (MCP_TRUSTED_CIDRS)", () => {
  it.each(["198.18.0.0/15", "10.47.83.1", "fd00::1", "fd00::/111", " 198.18.0.0/16 , 10.47.83.1 "])(
    "accepts %s",
    (raw) => {
      expect(parseTrustedCidrs(raw).length).toBeGreaterThan(0);
    },
  );

  it("reads unset, empty and blank as no exception", () => {
    expect(parseTrustedCidrs(undefined)).toEqual([]);
    expect(parseTrustedCidrs("")).toEqual([]);
    expect(parseTrustedCidrs(" , ")).toEqual([]);
  });

  it("names a faulty entry by its position, never by its text", () => {
    expect(() => parseTrustedCidrs("198.18.0.0/16, 10.0.0.0/8")).toThrow(
      /^MCP_TRUSTED_CIDRS: entry 2 of 2 is too wide \(at most \/15\)$/,
    );
    // Positions count the empty entries too.
    expect(() => parseTrustedCidrs("198.18.0.0/16,,fd00::1%secret")).toThrow(
      /^MCP_TRUSTED_CIDRS: entry 3 of 3 is not an IP address or CIDR range$/,
    );
  });

  it.each([
    "abc",
    "198.18.0.0/40",
    "198.18.0.0/1x",
    "198.18.0.0/15/2",
    "167772161",
    "10.1",
    "::ffff:198.18.0.0/111",
    "fd00::1%en0",
  ])("refuses the malformed %s", (raw) => {
    expect(() => parseTrustedCidrs(raw)).toThrow(/not an IP address or CIDR range/);
  });

  it.each(["::ffff:010.047.083.001", "::ffff:0xa.0x2f.0x53.0x1"])(
    "refuses the ambiguous IPv4 inside IPv6 %s",
    (raw) => {
      expect(() => parseTrustedCidrs(raw)).toThrow(/not an IP address or CIDR range/);
    },
  );

  it.each(["10.0.0.0/8", "198.18.0.0/14", "0.0.0.0/0", "fd00::/110", "::/0"])(
    "refuses %s, wider than 131,072 addresses",
    (raw) => {
      expect(() => parseTrustedCidrs(raw)).toThrow(/too wide/);
    },
  );

  it("caps all the entries together at 131,072 addresses", () => {
    expect(asText("198.18.0.0/16, 198.19.0.0/16")).toEqual(["198.18.0.0/16", "198.19.0.0/16"]);
    expect(() => parseTrustedCidrs("10.0.0.0/15, 10.2.0.0/15")).toThrow(
      /^MCP_TRUSTED_CIDRS: entry 2 of 2 brings the entries above 131,072 addresses$/,
    );
    expect(() => parseTrustedCidrs("198.18.0.0/15, 10.47.83.1")).toThrow(
      /^MCP_TRUSTED_CIDRS: entry 2 of 2 brings the entries above 131,072 addresses$/,
    );
  });

  it.each([
    "127.0.0.1",
    "127.0.0.0/16",
    "0.0.0.0",
    "169.254.169.254",
    "169.254.0.0/16",
    // Starts outside 169.254.0.0/16 but contains it.
    "169.255.0.0/15",
    "::1",
    "::",
    "fe80::1",
    "fe80::/112",
    // An IPv4-mapped IPv6 address is judged as the IPv4 it carries.
    "::ffff:127.0.0.1",
    // IPv6 ranges that carry an IPv4 under another prefix.
    "::7f00:1",
    "::ffff:0:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::1",
    "2002:a9fe:a9fe::1",
    "2001:0:a9fe:a9fe::1",
  ])(
    "refuses %s, which touches loopback, link-local, 0.0.0.0/8 or an IPv6 range carrying an IPv4",
    (raw) => {
      expect(() => parseTrustedCidrs(raw)).toThrow(/overlaps/);
    },
  );

  it("reads an IPv4-mapped IPv6 address as the IPv4 it carries", () => {
    expect(asText("::ffff:10.47.83.1")).toEqual(["10.47.83.1/32"]);
  });

  it("keeps a single IP as a one-address range and host bits as written", () => {
    expect(asText("10.47.83.1, fd00::1")).toEqual(["10.47.83.1/32", "fd00::1/128"]);
    expect(asText("198.18.1.0/15")).toEqual(["198.18.1.0/15"]);
  });

  it("tells how many ranges are trusted, never which", () => {
    expect(describeTrustedCidrs("198.18.0.0/15")).toBe("1 trusted range");
    expect(describeTrustedCidrs("10.47.83.1, 10.47.83.2")).toBe("2 trusted ranges");
    expect(describeTrustedCidrs(undefined)).toBe("");
  });
});

describe("assertSafeUrl with MCP_TRUSTED_CIDRS", () => {
  it("still refuses a fake-IP address when the variable is unset", async () => {
    await expect(assertSafeUrl("https://198.18.1.106/")).rejects.toThrow(
      /Refusing to fetch IP literal 198\.18\.1\.106/,
    );
  });

  it("accepts an address inside a trusted range, and only there", async () => {
    process.env.MCP_TRUSTED_CIDRS = "198.18.0.0/15";
    await expect(assertSafeUrl("https://198.18.1.106/")).resolves.toBeUndefined();
    await expect(assertSafeUrl("https://10.0.0.1/")).rejects.toThrow(/Refusing/);
    await expect(assertSafeUrl("https://127.0.0.1/")).rejects.toThrow(/Refusing/);
    await expect(assertSafeUrl("https://169.254.169.254/")).rejects.toThrow(/Refusing/);
    await expect(assertSafeUrl("https://1.1.1.1/")).resolves.toBeUndefined();
  });

  it("opens a single IP and nothing next to it", async () => {
    process.env.MCP_TRUSTED_CIDRS = "10.47.83.1";
    await expect(assertSafeUrl("https://10.47.83.1/")).resolves.toBeUndefined();
    await expect(assertSafeUrl("https://10.47.83.2/")).rejects.toThrow(/Refusing/);
  });

  it("never matches across address families", async () => {
    process.env.MCP_TRUSTED_CIDRS = "fd00::/111";
    await expect(assertSafeUrl("https://198.18.1.106/")).rejects.toThrow(/Refusing/);
    await expect(assertSafeUrl("https://[fd00::1]/")).resolves.toBeUndefined();
  });

  it("matches a range written with host bits on its prefix", async () => {
    process.env.MCP_TRUSTED_CIDRS = "10.47.83.5/31";
    await expect(assertSafeUrl("https://10.47.83.4/")).resolves.toBeUndefined();
    await expect(assertSafeUrl("https://10.47.83.6/")).rejects.toThrow(/Refusing/);
  });

  it("opens the IPv4 an IPv4-mapped entry carries", async () => {
    process.env.MCP_TRUSTED_CIDRS = "::ffff:10.47.83.1";
    await expect(assertSafeUrl("https://10.47.83.1/")).resolves.toBeUndefined();
  });

  it("never lifts the https rule nor the .localhost refusal", async () => {
    process.env.MCP_TRUSTED_CIDRS = "198.18.0.0/15";
    lookup.mockResolvedValue([{ address: "198.18.1.106", family: 4 }]);
    await expect(assertSafeUrl("http://198.18.1.106/")).rejects.toThrow(/Refusing to fetch http:/);
    await expect(assertSafeUrl("https://books.localhost/")).rejects.toThrow(/RFC 6761/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("follows a change of the variable", async () => {
    process.env.MCP_TRUSTED_CIDRS = "10.47.83.1";
    await expect(assertSafeUrl("https://198.18.1.106/")).rejects.toThrow(/Refusing/);
    process.env.MCP_TRUSTED_CIDRS = "198.18.0.0/15";
    await expect(assertSafeUrl("https://198.18.1.106/")).resolves.toBeUndefined();
  });

  it("accepts a DNS answer inside a trusted range", async () => {
    lookup.mockResolvedValue([{ address: "198.18.1.106", family: 4 }]);
    await expect(assertSafeUrl(API)).rejects.toThrow(/DNS resolved to 198\.18\.1\.106/);
    process.env.MCP_TRUSTED_CIDRS = "198.18.0.0/15";
    await expect(assertSafeUrl(API)).resolves.toBeUndefined();
  });

  it("refuses the host when any DNS answer is outside the trusted ranges", async () => {
    process.env.MCP_TRUSTED_CIDRS = "198.18.0.0/15";
    lookup.mockResolvedValue([
      { address: "198.18.1.106", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(assertSafeUrl(API)).rejects.toThrow(/DNS resolved to 10\.0\.0\.1/);
  });
});

describe("MCP_TRUSTED_CIDRS at startup", () => {
  it("stops the server on a bad value", () => {
    process.env.MCP_TRUSTED_CIDRS = "10.0.0.0/8";
    expect(() =>
      createServer({ apiKey: "secret-token:mercury_production_x", log: () => {} }),
    ).toThrow(/MCP_TRUSTED_CIDRS/);
  });

  it("announces how many ranges are trusted, never which", () => {
    process.env.MCP_TRUSTED_CIDRS = "198.18.0.0/15";
    const lines: string[] = [];
    createServer({
      apiKey: "secret-token:mercury_production_x",
      log: (msg: string) => lines.push(msg),
    });
    expect(lines).toContain("MCP_TRUSTED_CIDRS: the SSRF guard also accepts 1 trusted range");
    expect(lines.join("\n")).not.toContain("198.18");
  });
});
