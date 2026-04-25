import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/**
 * Runtime SSRF defense: before each outbound HTTP call, resolve the URL's
 * hostname and reject if any of its A/AAAA records points at a non-`unicast`
 * range (loopback, RFC 1918, RFC 3927 link-local, RFC 6598 carrier-grade
 * NAT, RFC 2544 benchmarking, RFC 5737 documentation, multicast, IPv6 ULA,
 * IPv6 link-local, etc.).
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
    const range = ipaddr.process(host).range();
    if (range !== "unicast") {
      throw new Error(`Refusing to fetch IP literal ${host} (range "${range}")`);
    }
    return;
  }

  // DNS hostname — resolve every record and classify each one.
  const records = await lookup(host, { all: true });
  for (const r of records) {
    if (!ipaddr.isValid(r.address)) continue;
    const range = ipaddr.process(r.address).range();
    if (range !== "unicast") {
      throw new Error(`Refusing to fetch ${host}: DNS resolved to ${r.address} (range "${range}")`);
    }
  }
}
