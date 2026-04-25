import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";

// Kept in sync with package.json by scripts/sync-version.mjs (called by the
// `npm version` lifecycle hook). Do not edit manually — bump via
// `npm version patch|minor|major`.
export const VERSION = "0.12.0";
export const SANDBOX_BASE_URL = "https://api-sandbox.mercury.com/api/v1";

export interface ServerOptions {
  apiKey: string;
  /** Override the Mercury API base URL (e.g. for a self-hosted proxy). */
  baseUrl?: string;
  /** Custom logger for sandbox detection / startup messages. Defaults to console.error. */
  log?: (msg: string) => void;
}

/**
 * Validate an explicit `MERCURY_API_BASE_URL` override before it is forwarded
 * to the Mercury client.
 *
 * Defense-in-depth layer. The bearer token + every API call is sent to this
 * URL. Without validation, an operator misconfiguration (or a host that lets
 * prompt-injected content reach env composition) could redirect traffic to
 * `http://attacker.tld` and silently exfiltrate credentials.
 *
 * Rules mirror `HttpsWebhookUrl` in `src/tools/webhooks.ts` for symmetry:
 *
 *   - HTTPS required: a plaintext or non-HTTP scheme would leak the bearer
 *     token + every payload in clear. The official Mercury API + sandbox are
 *     both HTTPS, so this rule costs the legitimate caller nothing.
 *   - Loopback / RFC 1918 / link-local / cloud-metadata / IPv6 ULA blocked:
 *     guards against accidental misconfiguration (e.g. a base URL pointing at
 *     `https://169.254.169.254/latest/meta-data` or a private corporate IP)
 *     and against prompt injections that try to bounce through an internal
 *     service. Mercury's own API is on a public hostname, so this rule costs
 *     the legitimate caller nothing.
 *
 * Throws on invalid input. The thrown message is logged at boot and never
 * leaked to the LLM channel.
 */
export function validateBaseUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `MERCURY_API_BASE_URL is not a valid URL (got ${JSON.stringify(raw)}). Expected an HTTPS URL such as https://api.mercury.com/api/v1.`,
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `MERCURY_API_BASE_URL must use https:// (got ${JSON.stringify(url.protocol)}). http, file, data, ftp, etc. are rejected to prevent bearer-token leakage.`,
    );
  }

  // `URL().hostname` returns IPv6 literals bracketed ([::1], [fe80::1]).
  // DNS names and IPv4 dotted-quads come back unbracketed. The brackets
  // are how we distinguish "this host is an IPv6 literal" from "this is
  // a DNS name that happens to contain a hex prefix" — without that
  // gate, a hostname like `fc00-proxy.example.com` would be wrongly
  // rejected as ULA because `parseInt("fc00-proxy", 16)` returns 0xfc00.
  // (Caught by CodeRabbit on this PR.)
  const rawHost = url.hostname.toLowerCase();
  const isIPv6Literal = rawHost.startsWith("[") && rawHost.endsWith("]");
  const host = isIPv6Literal ? rawHost.slice(1, -1) : rawHost;

  // RFC 6761 reserves the entire `.localhost` namespace as loopback —
  // not just the bare label. `localhost.`, `foo.localhost`, and
  // `foo.localhost.` all resolve to a loopback target on stacks that
  // honor the spec, so a bearer token sent to any of them leaks the
  // same way as `https://127.0.0.1/`. Reject the namespace as a
  // whole, before the non-IPv6 fast path. (Caught by CodeRabbit on
  // this PR.)
  if (
    host === "localhost" ||
    host === "localhost." ||
    host.endsWith(".localhost") ||
    host.endsWith(".localhost.")
  ) {
    throw new Error(
      "MERCURY_API_BASE_URL must be publicly reachable. Loopback hosts (the entire .localhost namespace per RFC 6761) are rejected.",
    );
  }

  // IPv4: match literal a.b.c.d and reject loopback, link-local, RFC 1918.
  const ipv4Match = (raw: string): null | { a: number; b: number } => {
    const m = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    return { a: Number(m[1]), b: Number(m[2]) };
  };

  const isPrivateIPv4 = ({ a, b }: { a: number; b: number }): boolean =>
    a === 0 || //                              0.0.0.0/8      "this host"/unspecified
    a === 127 || //                            127.0.0.0/8    loopback
    a === 10 || //                             10.0.0.0/8     RFC 1918
    (a === 169 && b === 254) || //             169.254.0.0/16 link-local + cloud metadata
    (a === 192 && b === 168) || //             192.168.0.0/16 RFC 1918
    (a === 172 && b >= 16 && b <= 31); //      172.16.0.0/12  RFC 1918

  if (!isIPv6Literal) {
    const ipv4 = ipv4Match(host);
    if (ipv4 && isPrivateIPv4(ipv4)) {
      throw new Error(
        `MERCURY_API_BASE_URL must be publicly reachable. Got ${host} which is loopback/RFC 1918/link-local/cloud-metadata.`,
      );
    }
    return; // DNS names that aren't loopback / IPv4-private get a pass.
  }

  // From here, `host` is an IPv6 literal (brackets stripped).

  // Loopback in any form: ::1, 0:0:0:0:0:0:0:1, etc.
  // Easy invariant: collapse runs of zero hextets and check for `::1` or `0::1`.
  const collapsedZeros = host.replace(/(?:^|:)(?:0+:)+/g, "::").replace(/::+/g, "::");
  if (collapsedZeros === "::1" || collapsedZeros === "0::1") {
    throw new Error(
      "MERCURY_API_BASE_URL must be publicly reachable. Loopback hosts are rejected.",
    );
  }

  // IPv4-mapped IPv6: re-run the IPv4 private-range check on the embedded
  // address, otherwise `[::ffff:127.0.0.1]` would slip past. Two shapes:
  //   - dotted-quad: `::ffff:127.0.0.1` (untouched by some parsers)
  //   - hex pair: `::ffff:7f00:1` (Node's `URL().hostname` canonicalises to this)
  const ipv4MappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (ipv4MappedDotted) {
    const inner = ipv4Match(ipv4MappedDotted[1]);
    if (inner && isPrivateIPv4(inner)) {
      throw new Error(
        `MERCURY_API_BASE_URL must be publicly reachable. Got ${host} which embeds a private IPv4 address.`,
      );
    }
    return;
  }
  const ipv4MappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (ipv4MappedHex) {
    // Only the high 16 bits decide the private-range outcome — the
    // `isPrivateIPv4` predicate inspects octets a + b, none of c + d.
    // Skip parsing the low pair to avoid an unused-variable lint flag
    // (caught by CodeRabbit on the IPv6 follow-up commit).
    const high = Number.parseInt(ipv4MappedHex[1], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    if (isPrivateIPv4({ a, b })) {
      throw new Error(
        `MERCURY_API_BASE_URL must be publicly reachable. Got ${host} which embeds a private IPv4 address.`,
      );
    }
    return;
  }

  // IPv6 CIDR bitmask check on the first hextet of an actual IPv6 literal.
  //   fc00::/7  → first 7 bits = 0b1111110 → mask 0xfe00, match 0xfc00 (ULA)
  //   fe80::/10 → first 10 bits = 0b1111111010 → mask 0xffc0, match 0xfe80 (link-local)
  // Safe to parseInt here because we already know the host is bracketed IPv6.
  const firstHextet = Number.parseInt(host.split(":")[0] || "0", 16);
  if (!Number.isNaN(firstHextet)) {
    if ((firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80) {
      throw new Error(
        `MERCURY_API_BASE_URL must be publicly reachable. Got ${host} which is in a private IPv6 range (fc00::/7 ULA or fe80::/10 link-local).`,
      );
    }
  }
}

/**
 * Resolve the Mercury API base URL from the API key + an optional explicit
 * override. Sandbox tokens (containing "mercury_sandbox_") are auto-detected.
 *
 * Validates an explicit override via `validateBaseUrl` — see that function
 * for the rule set.
 */
export function resolveBaseUrl(apiKey: string, explicitBaseUrl?: string): string | undefined {
  // Treat `MERCURY_API_BASE_URL=""` as a provided-but-invalid override
  // rather than as "unset" — otherwise an operator who exports the env
  // variable and then forgets to fill it would silently fall back to
  // sandbox-or-prod auto-detection, defeating the fail-closed posture
  // (caught by CodeRabbit on this PR).
  if (explicitBaseUrl !== undefined) {
    validateBaseUrl(explicitBaseUrl);
    return explicitBaseUrl;
  }
  // Strict prefix match so a token like "mercury_production_with_word_sandbox_in_it"
  // is not accidentally routed to sandbox.
  if (apiKey.startsWith("secret-token:mercury_sandbox_")) return SANDBOX_BASE_URL;
  return undefined;
}

/**
 * Build a fully wired MCP server: Mercury client + middleware-wrapped tools.
 * Does NOT connect to any transport — the caller decides (stdio for production,
 * InMemoryTransport for tests).
 */
export function createServer(opts: ServerOptions): McpServer {
  const log = opts.log ?? ((msg: string) => console.error(msg));

  const baseUrl = resolveBaseUrl(opts.apiKey, opts.baseUrl);
  if (baseUrl === SANDBOX_BASE_URL && !opts.baseUrl) {
    log("Detected sandbox token → using https://api-sandbox.mercury.com/api/v1");
  }

  const client = new MercuryClient({ apiKey: opts.apiKey, baseUrl });

  const server = new McpServer({
    name: "mercury-invoicing-mcp",
    version: VERSION,
  });

  registerAllTools(server, client);
  registerAllPrompts(server);

  return server;
}
