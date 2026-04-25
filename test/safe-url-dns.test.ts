import { vi, describe, it, expect, beforeEach } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

const { assertSafeUrl } = await import("../src/safe-url.js");

describe("assertSafeUrl — DNS resolution path (mocked)", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("rejects hostname that DNS resolves to an RFC 1918 IPv4", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await expect(assertSafeUrl("https://example.test/api")).rejects.toThrow(
      /DNS resolved to 10\.0\.0\.1/,
    );
  });

  it("rejects hostname that DNS resolves to cloud-metadata link-local", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(assertSafeUrl("https://meta.example.test/")).rejects.toThrow(
      /DNS resolved to 169\.254\.169\.254/,
    );
  });

  it("rejects when any record in a multi-record reply is non-unicast", async () => {
    lookupMock.mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(assertSafeUrl("https://mixed.example.test/")).rejects.toThrow(
      /DNS resolved to 127\.0\.0\.1/,
    );
  });

  it("rejects hostname that DNS resolves to an IPv6 ULA", async () => {
    lookupMock.mockResolvedValue([{ address: "fc00::1", family: 6 }]);
    await expect(assertSafeUrl("https://ula.example.test/")).rejects.toThrow(
      /DNS resolved to fc00::1/,
    );
  });

  it("accepts hostname that DNS resolves only to public unicast IPs", async () => {
    lookupMock.mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    await expect(assertSafeUrl("https://safe.example.test/api")).resolves.toBeUndefined();
  });

  it("skips records whose address is not a parseable IP literal (defensive guard)", async () => {
    // Exercises the `if (!ipaddr.isValid(r.address)) continue;` branch.
    // node:dns normally guarantees `address` is a valid IP literal — this
    // test pins the behaviour if a future Node change ever returns junk.
    lookupMock.mockResolvedValue([{ address: "not-an-ip", family: 4 }]);
    await expect(assertSafeUrl("https://garbage.example.test/")).resolves.toBeUndefined();
  });
});
