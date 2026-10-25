import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/**
 * Runtime SSRF defense: before each outbound HTTP call, resolve the URL's
 * hostname and reject if any of its A/AAAA records points at a non-`unicast`
 * range (loopback, RFC 1918, RFC 3927 link-local, RFC 6598 carrier-grade
 * NAT, RFC 2544 benchmarking, RFC 5737 documentation, multicast, IPv6 ULA,
 * IPv6 link-local, etc.).
 *
 * Exception: an address inside a range the operator trusts explicitly
 * (`MCP_TRUSTED_CIDRS`, see `parseTrustedCidrs`) is accepted.
 *
 * Why this exists in addition to `validateBaseUrl()`:
 *
 *   `validateBaseUrl()` runs once at startup against the URL string. It
 *   does not protect against:
 *     - DNS rebinding (DNS resolves to public at boot, private later).
 *     - HTTP redirect chains that land on a private host.
 *     - URL changes mid-process.
 *
 *   `assertSafeUrl()` runs before every fetch and re-classifies the
 *   resolved IPs. Combined with `validateBaseUrl()` at boot, this is the
 *   same defense layer as `request-filtering-agent`-style request gating
 *   while keeping the native Node `fetch` API (no `node-fetch` migration).
 *
 *   Residual: tiny TOCTOU window between this lookup and the actual TCP
 *   connect — DNS could rebind in milliseconds. That window is documented
 *   in `.github/SECURITY.md`; closing it would require socket-level
 *   interception (custom undici dispatcher, future work).
 */
export async function assertSafeUrl(rawUrl: string | URL): Promise<void> {
  let parsed: URL;
  try {
    parsed = typeof rawUrl === "string" ? new URL(rawUrl) : rawUrl;
  } catch {
    throw new Error(`Refusing to fetch invalid URL: ${String(rawUrl)}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Refusing to fetch ${parsed.protocol}// URL — bearer token would leak in clear`,
    );
  }

  const rawHost = parsed.hostname.toLowerCase();
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;

  // RFC 6761 .localhost namespace — reject before any DNS lookup.
  if (
    host === "localhost" ||
    host === "localhost." ||
    host.endsWith(".localhost") ||
    host.endsWith(".localhost.")
  ) {
    throw new Error(`Refusing to fetch RFC 6761 loopback host: ${host}`);
  }

  // IP literal — classify directly via ipaddr.js, skip DNS.
  if (ipaddr.isValid(host)) {
    const addr = ipaddr.process(host);
    const range = addr.range();
    if (range !== "unicast" && !isTrusted(addr)) {
      throw new Error(`Refusing to fetch IP literal ${host} (range "${range}")`);
    }
    return;
  }

  // DNS hostname — resolve every record and classify each one.
  const records = await lookup(host, { all: true });
  for (const r of records) {
    if (!ipaddr.isValid(r.address)) continue;
    const addr = ipaddr.process(r.address);
    const range = addr.range();
    if (range !== "unicast" && !isTrusted(addr)) {
      throw new Error(`Refusing to fetch ${host}: DNS resolved to ${r.address} (range "${range}")`);
    }
  }
}

type Cidr = [ipaddr.IPv4 | ipaddr.IPv6, number];

// Ranges an operator can never mark as trusted: loopback, link-local (where the
// cloud metadata endpoint 169.254.169.254 lives), the unspecified network, and
// the IPv6 ranges that carry an IPv4 address and could lead back to those
// (IPv4-compatible, IPv4-translated, NAT64, 6to4, Teredo).
const NEVER_TRUSTED: Cidr[] = [
  "127.0.0.0/8",
  "0.0.0.0/8",
  "169.254.0.0/16",
  "::1/128",
  "::/128",
  "fe80::/10",
  "::/96",
  "::ffff:0:0:0/96",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
  "2002::/16",
  "2001::/32",
].map((c) => ipaddr.parseCIDR(c));

// At most 2^17 = 131,072 trusted addresses, all entries together: the size of
// Surge's 198.18.0.0/15 fake-IP pool (one range: IPv4 /15, IPv6 /111).
const MAX_HOST_BITS = 17;
const MAX_ADDRESSES = 2 ** MAX_HOST_BITS;

function inRange(addr: ipaddr.IPv4 | ipaddr.IPv6, [net, bits]: Cidr): boolean {
  return addr.kind() === net.kind() && addr.match(net, bits);
}

function parseEntry(entry: string, label: string): Cidr {
  // Typed wide: an entry may lack the prefix part, or carry a stray third one.
  const [ip = "", bits, extra] = entry.split("/") as (string | undefined)[];
  // An IPv4 written inside an IPv6 address must be four decimal parts too;
  // an IPv6 zone (fe80::1%en0) has no meaning here.
  const dotted =
    ip.includes(":") && ip.includes(".") ? ip.slice(ip.lastIndexOf(":") + 1) : undefined;
  const strict =
    ipaddr.IPv4.isValidFourPartDecimal(ip) ||
    (!ip.includes("%") &&
      ipaddr.IPv6.isValid(ip) &&
      (dotted === undefined || ipaddr.IPv4.isValidFourPartDecimal(dotted)));
  if (!strict || extra !== undefined || (bits !== undefined && !/^\d{1,3}$/.test(bits))) {
    throw new Error(`MCP_TRUSTED_CIDRS: ${label} is not an IP address or CIDR range`);
  }
  // An IPv4-mapped address (::ffff:10.47.83.1) is read as the IPv4 it carries.
  const addr = ipaddr.process(ip);
  const width = addr.kind() === "ipv4" ? 32 : 128;
  if (bits === undefined) return [addr, width];
  if (addr.kind() !== ipaddr.parse(ip).kind() || Number(bits) > width) {
    throw new Error(`MCP_TRUSTED_CIDRS: ${label} is not an IP address or CIDR range`);
  }
  return [addr, Number(bits)];
}

/**
 * Parse `MCP_TRUSTED_CIDRS`: comma-separated IP addresses or CIDR ranges whose
 * addresses the guard accepts although they are not public unicast — e.g. the
 * fake-IP pool of a local proxy such as Surge (`198.18.0.0/15`). A single IP
 * is the preferred form; an IPv4-mapped IPv6 address counts as its IPv4.
 * Unset or empty = no exception. Throws on a malformed entry, on more than
 * 131,072 addresses (one range or all together), and on a range that overlaps
 * loopback, link-local, 0.0.0.0/8 or an IPv6 range carrying an IPv4. An entry
 * is named by its position, never by its text, which comes from the environment.
 */
export function parseTrustedCidrs(raw: string | undefined): Cidr[] {
  if (!raw) return [];
  const entries = raw.split(",").map((entry) => entry.trim());
  let addresses = 0;
  const ranges = entries.flatMap((entry, index): Cidr[] => {
    if (entry === "") return [];
    const label = `entry ${index + 1} of ${entries.length}`;
    const cidr = parseEntry(entry, label);
    const width = cidr[0].kind() === "ipv4" ? 32 : 128;
    const hostBits = width - cidr[1];
    if (hostBits > MAX_HOST_BITS) {
      throw new Error(
        `MCP_TRUSTED_CIDRS: ${label} is too wide (at most /${width - MAX_HOST_BITS})`,
      );
    }
    for (const forbidden of NEVER_TRUSTED) {
      if (inRange(cidr[0], forbidden) || inRange(forbidden[0], cidr)) {
        throw new Error(
          `MCP_TRUSTED_CIDRS: ${label} overlaps ${forbidden[0].toString()}/${forbidden[1]}`,
        );
      }
    }
    addresses += 2 ** hostBits;
    if (addresses > MAX_ADDRESSES) {
      throw new Error(`MCP_TRUSTED_CIDRS: ${label} brings the entries above 131,072 addresses`);
    }
    return [cidr];
  });
  return ranges;
}

/** Startup note: how many ranges are trusted, never which ("" when none). */
export function describeTrustedCidrs(raw: string | undefined): string {
  const count = parseTrustedCidrs(raw).length;
  if (count === 0) return "";
  return count === 1 ? "1 trusted range" : `${count} trusted ranges`;
}

let trustedCache: { raw: string | undefined; ranges: Cidr[] } | undefined;

function isTrusted(addr: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  const raw = process.env.MCP_TRUSTED_CIDRS;
  if (!trustedCache || trustedCache.raw !== raw) {
    trustedCache = { raw, ranges: parseTrustedCidrs(raw) };
  }
  return trustedCache.ranges.some((cidr) => inRange(addr, cidr));
}
