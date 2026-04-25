import { assertSafeUrl } from "../src/safe-url.js";

describe("assertSafeUrl — IP literal path (no DNS)", () => {
  it("accepts a public IPv4 literal", async () => {
    await expect(assertSafeUrl("https://1.1.1.1/api")).resolves.toBeUndefined();
  });

  it("rejects loopback IPv4 literal", async () => {
    await expect(assertSafeUrl("https://127.0.0.1/api")).rejects.toThrow(/loopback/);
  });

  it("rejects RFC 1918 private IPv4 literal", async () => {
    await expect(assertSafeUrl("https://10.0.0.1/api")).rejects.toThrow(/private/);
    await expect(assertSafeUrl("https://192.168.1.1/api")).rejects.toThrow(/private/);
  });

  it("rejects link-local IPv4 (cloud-metadata)", async () => {
    await expect(assertSafeUrl("https://169.254.169.254/")).rejects.toThrow(/linkLocal/);
  });

  it("rejects RFC 6598 carrier-grade NAT (100.64/10)", async () => {
    await expect(assertSafeUrl("https://100.64.0.5/api")).rejects.toThrow(/carrierGradeNat/);
  });

  it("rejects IPv6 loopback / ULA / link-local literals", async () => {
    await expect(assertSafeUrl("https://[::1]/api")).rejects.toThrow(/loopback/);
    await expect(assertSafeUrl("https://[fc00::1]/api")).rejects.toThrow(/uniqueLocal/);
    await expect(assertSafeUrl("https://[fe80::1]/api")).rejects.toThrow(/linkLocal/);
  });

  it("rejects any non-https scheme", async () => {
    await expect(assertSafeUrl("http://1.1.1.1/api")).rejects.toThrow(/bearer token/);
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(/bearer token/);
  });

  it("rejects RFC 6761 .localhost namespace", async () => {
    await expect(assertSafeUrl("https://localhost/api")).rejects.toThrow(/RFC 6761/);
    await expect(assertSafeUrl("https://foo.localhost/api")).rejects.toThrow(/RFC 6761/);
    await expect(assertSafeUrl("https://localhost./api")).rejects.toThrow(/RFC 6761/);
  });

  it("rejects an invalid URL string", async () => {
    await expect(assertSafeUrl("not-a-url")).rejects.toThrow(/invalid URL/);
  });
});
