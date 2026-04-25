import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import ipaddr from "ipaddr.js";
import { MercuryClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllPrompts } from "./prompts/index.js";

// Kept in sync with package.json by scripts/sync-version.mjs (called by the
// `npm version` lifecycle hook). Do not edit manually — bump via
// `npm version patch|minor|major`.
export const VERSION = "0.13.0";
export const SANDBOX_BASE_URL = "https://api-sandbox.mercury.com/api/v1";

// Strict allowlist of Mercury hostnames `validateBaseUrl()` accepts without
// the explicit `MERCURY_MCP_ALLOW_NON_MERCURY_HOST=true` opt-in. New entries
// require explicit code review (no wildcard).
export const MERCURY_HOSTS = ["api.mercury.com", "api-sandbox.mercury.com"] as const;

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
 * Rules:
 *
 *   - HTTPS required: a plaintext or non-HTTP scheme would leak the bearer
 *     token + every payload in clear. The official Mercury API + sandbox are
 *     both HTTPS, so this rule costs the legitimate caller nothing.
 *   - RFC 6761 `.localhost` namespace blocked (covers `localhost`,
 *     `localhost.`, `foo.localhost`, `foo.localhost.`). DNS-level loopback.
 *   - IP-literal classification delegated to `ipaddr.js` — accept only the
 *     `unicast` range. Everything else (loopback / private / linkLocal /
 *     carrierGradeNat / benchmarking / documentation / multicast /
 *     uniqueLocal / etc.) is rejected. This pulls in the IANA-tracked range
 *     set so we do not have to maintain a hand-written CIDR list and do not
 *     drift when IANA reserves new ranges.
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
  // DNS names and IPv4 dotted-quads come back unbracketed. Brackets are
  // also how we tell "this is an IPv6 literal" from "this is a DNS name
  // that happens to contain a hex-shaped substring" — `fc00-proxy.example.com`
  // is a perfectly valid DNS name and must pass.
  const rawHost = url.hostname.toLowerCase();
  const isIPv6Literal = rawHost.startsWith("[") && rawHost.endsWith("]");
  const host = isIPv6Literal ? rawHost.slice(1, -1) : rawHost;

  // RFC 6761: the entire `.localhost` namespace resolves to a loopback
  // target on conforming stacks. Reject it at the DNS level before any
  // IP-literal classification.
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

  // If the host parses as an IP literal, classify it via `ipaddr.js` and
  // accept only the `unicast` range. The library covers every IANA-tracked
  // reserved range — loopback (RFC 5735), private (RFC 1918), linkLocal
  // (RFC 3927 + IPv6 fe80::/10), carrierGradeNat (RFC 6598),
  // benchmarking (RFC 2544), documentation (RFC 5737 + RFC 3849), multicast,
  // uniqueLocal (IPv6 fc00::/7), reserved, etc. — without us having to
  // maintain a hand-rolled CIDR list. IPv4-mapped IPv6 (`::ffff:a.b.c.d`,
  // `::ffff:7f00:1`) is normalised by ipaddr.js into the underlying IPv4
  // range, so a mapped private address is rejected the same way as the
  // bare IPv4 form.
  if (ipaddr.isValid(host)) {
    const range = ipaddr.process(host).range();
    if (range !== "unicast") {
      // Stable user-facing message — explicitly do NOT interpolate the
      // raw `range` value from `ipaddr.js`. The library's classification
      // taxonomy is an internal implementation detail; coupling the
      // contract to those exact label strings would force a release
      // every time upstream renames a label (uniqueLocal → ULA, etc.)
      // and would force test fixtures to track those renames too.
      // Log the raw range to stderr for debug-level diagnosis instead.
      // (Caught by CodeRabbit on this PR.)
      console.error(`[validateBaseUrl] rejected host=${host} ipaddr.js-range=${range}`);
      throw new Error(
        `MERCURY_API_BASE_URL must point at a publicly reachable IP — ${host} is in a non-public range (loopback / private / link-local / carrier-grade NAT / reserved / IPv6 ULA / ...).`,
      );
    }
  }

  // Default-allow only the two official Mercury API hostnames. The
  // previous rules (HTTPS-only + non-public-range gate) keep an
  // attacker-controlled env var like
  // `MERCURY_API_BASE_URL=https://attacker.example.com` from pointing
  // at a private host, but they still let it route the bearer token
  // to *any* public host. Lock the allowlist to the exact strings
  // Mercury actually exposes — no `*.mercury.com` wildcard, because
  // any subdomain Mercury adds in the future would also need code
  // review before it inherits write access to the bearer token.
  // Legitimate self-hosted proxies / observability shims opt in via
  // `MERCURY_MCP_ALLOW_NON_MERCURY_HOST=true`, which surfaces a loud
  // stderr warning so the deviation is visible at boot.
  const isMercuryHost = (MERCURY_HOSTS as readonly string[]).includes(host);
  if (!isMercuryHost) {
    if (process.env.MERCURY_MCP_ALLOW_NON_MERCURY_HOST !== "true") {
      throw new Error(
        `MERCURY_API_BASE_URL=${host} is not a Mercury hostname. Set MERCURY_MCP_ALLOW_NON_MERCURY_HOST=true to opt in to a custom proxy / observability shim — be aware the bearer token + every API payload will be sent to that host.`,
      );
    }
    console.error(
      `[validateBaseUrl] WARNING: MERCURY_API_BASE_URL points at a non-Mercury host (${host}). Bearer token + every API payload will be sent there. Opted in via MERCURY_MCP_ALLOW_NON_MERCURY_HOST=true.`,
    );
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
