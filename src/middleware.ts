/**
 * MCP middleware: dry-run, dual-window rate limiting, audit log.
 *
 * Each write tool is associated with a bucket. Buckets enforce two
 * rolling windows simultaneously:
 *   - daily  (24h)
 *   - monthly (30-day rolling)
 * A call is rejected as soon as either window is at its cap. The daily
 * window is checked first so an explicit "Daily Limit Exceeded" is
 * surfaced when both caps are hit at once.
 *
 * Persistence: ~/.mercury-mcp/ratelimit.json (mode 0o600, atomic write).
 * State is keyed by bucket; entries are arrays of Unix-ms timestamps
 * pruned to the monthly window on every access.
 *
 * Env overrides:
 *   MERCURY_MCP_RATE_LIMIT_<BUCKET>=D/day,M/month
 *   MERCURY_MCP_RATE_LIMIT_DISABLE=true    # disable all limits
 */

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { MercuryError } from "./client.js";

const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS; // 30-day rolling window

/**
 * Tool → bucket. Tools that share a bucket also share the same
 * history array (e.g. `send_money` and `request_send_money` both
 * count against the `payments` bucket).
 */
const TOOL_BUCKET: Record<string, string> = {
  // Money out
  mercury_send_money: "payments",
  mercury_request_send_money: "payments",
  mercury_create_internal_transfer: "internal_transfer",

  // Invoicing
  mercury_create_invoice: "invoices_write",
  mercury_update_invoice: "invoices_write",
  mercury_cancel_invoice: "invoices_cancel",

  // Customers (AR)
  mercury_create_customer: "customers_write",
  mercury_update_customer: "customers_write",
  mercury_delete_customer: "customers_write",

  // Banking writes
  mercury_add_recipient: "recipients_add",
  mercury_update_recipient: "recipients_update",
  mercury_update_transaction: "transactions_update",

  // Webhooks
  mercury_create_webhook: "webhooks_create",
  mercury_update_webhook: "webhooks_update",
  mercury_delete_webhook: "webhooks_delete",
};

interface BucketLimit {
  daily: number;
  monthly: number;
}

const DEFAULT_BUCKET_LIMITS: Record<string, BucketLimit> = {
  payments: { daily: 7, monthly: 150 },
  internal_transfer: { daily: 2, monthly: 40 },
  invoices_write: { daily: 10, monthly: 200 },
  invoices_cancel: { daily: 3, monthly: 30 },
  customers_write: { daily: 3, monthly: 60 },
  recipients_add: { daily: 3, monthly: 45 },
  recipients_update: { daily: 2, monthly: 15 },
  transactions_update: { daily: 50, monthly: 500 },
  webhooks_create: { daily: 2, monthly: 15 },
  webhooks_update: { daily: 2, monthly: 15 },
  webhooks_delete: { daily: 2, monthly: 15 },
};

/**
 * Parse an override env var of the form "D/day,M/month".
 * Returns null on malformed input so the caller can fall back.
 */
function parseOverride(raw: string): BucketLimit | null {
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const dailyM = parts[0].match(/^(\d+)\s*\/\s*day$/i);
  const monthlyM = parts[1].match(/^(\d+)\s*\/\s*month$/i);
  if (!dailyM || !monthlyM) return null;
  const daily = Number(dailyM[1]);
  const monthly = Number(monthlyM[1]);
  if (daily < 1 || monthly < 1) return null;
  return { daily, monthly };
}

function getBucketLimit(bucket: string): BucketLimit | null {
  const envKey = `MERCURY_MCP_RATE_LIMIT_${bucket}`;
  const raw = process.env[envKey];
  if (raw) {
    const parsed = parseOverride(raw);
    if (parsed) return parsed;
    console.error(
      `Invalid rate limit format for ${envKey}: "${raw}" — expected like "7/day,150/month". Using default.`,
    );
  }
  return DEFAULT_BUCKET_LIMITS[bucket] ?? null;
}

const callHistory = new Map<string, number[]>();
let stateLoaded = false;

function getStateFile(): string {
  const dir = process.env.MERCURY_MCP_STATE_DIR || join(homedir(), ".mercury-mcp");
  return join(dir, "ratelimit.json");
}

function loadCallHistory(): void {
  if (stateLoaded) return;
  const path = getStateFile();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Cold start: no prior state to load. Mark loaded so the first
      // enforce can persist its first record.
      stateLoaded = true;
      return;
    }
    // Other read errors (EACCES, EIO…): do NOT mark loaded. We do not
    // know the prior counter, and if we marked loaded here, the next
    // persist would clobber the unreadable-but-present state file with
    // an empty counter — silently resetting the rate limit. Keeping
    // stateLoaded=false makes persistCallHistory a no-op (see below)
    // and lets the next enforce retry the read.
    console.error(`[ratelimit] failed to read state from ${path}: ${(err as Error).message}`);
    return;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(v) && v.every((n) => typeof n === "number")) {
          callHistory.set(k, v);
        }
      }
    }
  } catch (err) {
    // Corrupted JSON: we *did* read the file, so a fresh start is the
    // documented recovery — overwriting the corrupt file is intentional.
    console.error(
      `[ratelimit] corrupted state at ${path}, starting fresh: ${(err as Error).message}`,
    );
  }
  stateLoaded = true;
}

function persistCallHistory(): void {
  // Refuse to persist if we never successfully loaded the prior state.
  // Otherwise we would overwrite a present-but-unreadable state file with
  // an empty counter — silently resetting the rate limit on EACCES/EIO.
  if (!stateLoaded) return;
  const path = getStateFile();
  // Per-write unique tmp filename so two MCP processes that both call
  // persistCallHistory at the same instant cannot clobber each other's
  // tmp file before either rename completes. The rename itself is atomic.
  // Caveat: this still does not give us inter-process serialization of the
  // read-modify-write cycle — see SECURITY.md "single-process state" entry.
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const obj: Record<string, number[]> = {};
    for (const [k, v] of callHistory) obj[k] = v;
    writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    console.error(`[ratelimit] failed to persist state to ${path}: ${(err as Error).message}`);
  }
}

/** Reset in-memory call history. Useful for tests. */
export function resetRateLimitHistory(): void {
  callHistory.clear();
  stateLoaded = false;
}

export type LimitType = "daily" | "monthly";

export class RateLimitError extends Error {
  constructor(
    public toolName: string,
    public bucket: string,
    public limitType: LimitType,
    public limit: number,
    public retryAfterMs: number,
  ) {
    const retryMinutes = Math.ceil(retryAfterMs / 60_000);
    const windowLabel = limitType === "daily" ? "24h" : "30-day rolling";
    const title = limitType === "daily" ? "Daily Limit Exceeded" : "Monthly Limit Exceeded";
    super(
      `${title}: ${toolName} (bucket: ${bucket}) capped at ${limit} per ${windowLabel}. ` +
        `Retry in ~${retryMinutes} min. ` +
        `Override with MERCURY_MCP_RATE_LIMIT_${bucket}=D/day,M/month if this is a legitimate batch.`,
    );
    this.name = "RateLimitError";
  }
}

/**
 * Enforce both rate-limit windows for a tool call.
 *
 * - No-op for read tools or tools not in TOOL_BUCKET
 * - Prunes records older than the monthly window before counting
 * - Daily window checked first (so an explicit "Daily Limit Exceeded"
 *   is surfaced when both caps happen to land at the same instant)
 * - On allow: appends a timestamp and persists state
 * - On deny: throws RateLimitError with the limit type that failed
 */
export function enforceRateLimit(toolName: string): void {
  if (process.env.MERCURY_MCP_RATE_LIMIT_DISABLE === "true") return;

  const bucket = TOOL_BUCKET[toolName];
  if (!bucket) return; // read tool or untracked → no limit

  const limits = getBucketLimit(bucket);
  if (!limits) return;

  loadCallHistory();

  const now = Date.now();
  // Prune: keep only records within the monthly window
  const records = (callHistory.get(bucket) ?? []).filter((ts) => now - ts < MONTH_MS);

  // Daily window: records within the last 24h
  const dailyRecords = records.filter((ts) => now - ts < DAY_MS);
  if (dailyRecords.length >= limits.daily) {
    const retryAfterMs = DAY_MS - (now - dailyRecords[0]);
    throw new RateLimitError(toolName, bucket, "daily", limits.daily, retryAfterMs);
  }

  // Monthly window: records is already pruned to 30 days
  if (records.length >= limits.monthly) {
    const retryAfterMs = MONTH_MS - (now - records[0]);
    throw new RateLimitError(toolName, bucket, "monthly", limits.monthly, retryAfterMs);
  }

  records.push(now);
  callHistory.set(bucket, records);
  persistCallHistory();
}

export function isDryRun(): boolean {
  return process.env.MERCURY_MCP_DRY_RUN === "true";
}

/**
 * Lower-case names of fields that must never appear in audit logs, dry-run
 * payloads, or error responses. Exported so test/fuzz.test.ts can use the
 * canonical list (avoids drift between implementation and properties).
 *
 * Frozen at runtime: `as const` only widens the type, so without
 * Object.freeze the exported array would still be mutable from outside the
 * module. Freezing locks it down at runtime too.
 */
export const SENSITIVE_KEYS = Object.freeze([
  "accountnumber",
  "routingnumber",
  "apikey",
  "authorization",
  "password",
  "token",
  "secret",
  "ssn",
] as const);

const SENSITIVE_KEYS_SET: ReadonlySet<string> = new Set(SENSITIVE_KEYS);

export function redactSensitive(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSensitive);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS_SET.has(k.toLowerCase()) ? "[REDACTED]" : redactSensitive(v);
  }
  return out;
}

export function logAudit(
  toolName: string,
  args: unknown,
  result: "ok" | "dry-run" | "error",
): void {
  const path = process.env.MERCURY_MCP_AUDIT_LOG;
  if (!path) return;
  if (!isAbsolute(path)) {
    console.error(`[audit] MERCURY_MCP_AUDIT_LOG must be an absolute path; got: ${path}`);
    return;
  }
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    tool: toolName,
    result,
    args: redactSensitive(args),
  });
  try {
    appendFileSync(path, entry + "\n", { mode: 0o600 });
  } catch (err) {
    console.error(`[audit] failed to write to ${path}:`, (err as Error).message);
  }
}

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * Format a RateLimitError as a structured JSON payload for the MCP client.
 *
 * The `source: "mcp_safeguard"` + `mcp_rate_limit_…` prefix make it
 * unambiguous that this is a *local* cap enforced by the MCP itself —
 * the call was never sent to Mercury. A real Mercury 429 comes back
 * formatted as "Mercury API error 429: …" via the MercuryError branch
 * in wrapToolHandler; the two are distinct.
 */
function formatRateLimitError(err: RateLimitError): string {
  const retryAfter = new Date(Date.now() + err.retryAfterMs).toISOString();
  const windowLabel = err.limitType === "daily" ? "Daily" : "Monthly";
  return JSON.stringify(
    {
      source: "mcp_safeguard",
      error_type: `mcp_rate_limit_${err.limitType}_exceeded`,
      message: `MCP Rate Limit Exceeded — ${windowLabel} (local safeguard, not a Mercury API error)`,
      hint: err.message,
      retry_after: retryAfter,
    },
    null,
    2,
  );
}

/**
 * Wrap a tool handler with rate limit, dry-run, and audit middleware.
 * - Rate limit: returns structured isError payload if either window exceeded
 * - Dry-run: returns a mock response without calling Mercury
 * - Audit log: writes structured entry to MERCURY_MCP_AUDIT_LOG if set
 */
export function wrapToolHandler<TArgs>(
  toolName: string,
  handler: (args: TArgs) => Promise<ToolResult>,
): (args: TArgs) => Promise<ToolResult> {
  const isWriteOp = toolName in TOOL_BUCKET;

  return async (args: TArgs): Promise<ToolResult> => {
    if (isWriteOp) {
      try {
        enforceRateLimit(toolName);
      } catch (err) {
        if (err instanceof RateLimitError) {
          logAudit(toolName, args, "error");
          return {
            content: [{ type: "text", text: formatRateLimitError(err) }],
            isError: true,
          };
        }
        /* istanbul ignore next -- defensive: enforceRateLimit only ever
           throws RateLimitError today; this re-throw guards against a
           future regression that would surface as a programming bug, not
           a runtime path we can exercise from a unit test. */
        throw err;
      }
    }

    if (isWriteOp && isDryRun()) {
      logAudit(toolName, args, "dry-run");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                dryRun: true,
                tool: toolName,
                wouldCallWith: redactSensitive(args),
                note: "MERCURY_MCP_DRY_RUN=true; no actual Mercury API call was made. Sensitive fields are redacted.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    try {
      const result = await handler(args);
      if (isWriteOp) logAudit(toolName, args, "ok");
      return result;
    } catch (err) {
      logAudit(toolName, args, "error");
      if (err instanceof MercuryError) {
        const isAR = toolName.includes("invoice") || toolName.includes("customer");
        const planHint =
          err.status === 403 && isAR
            ? " (Mercury's Invoicing/Customers API requires the Plus plan or higher.)"
            : "";
        return {
          content: [
            {
              type: "text",
              text: `Mercury API error ${err.status}: ${err.message}${planHint}`,
            },
          ],
          isError: true,
        };
      }
      throw err;
    }
  };
}
