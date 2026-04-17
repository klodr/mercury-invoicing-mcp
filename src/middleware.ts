/**
 * MCP middleware: dry-run, rate limiting, audit log.
 */

const TOOL_CATEGORIES: Record<string, string> = {
  // Money movements
  mercury_send_money: "money",
  mercury_request_send_money: "money",
  // AR (invoicing + customers)
  mercury_create_invoice: "invoicing",
  mercury_update_invoice: "invoicing",
  mercury_send_invoice: "invoicing",
  mercury_cancel_invoice: "invoicing",
  mercury_create_customer: "invoicing",
  mercury_update_customer: "invoicing",
  mercury_delete_customer: "invoicing",
  // Banking writes
  mercury_add_recipient: "banking",
  mercury_update_recipient: "banking",
  mercury_update_transaction: "banking",
  // Webhooks (config)
  mercury_create_webhook: "webhooks",
  mercury_update_webhook: "webhooks",
  mercury_delete_webhook: "webhooks",
  // COA Templates (config)
  mercury_create_coa_template: "coa",
  mercury_update_coa_template: "coa",
  mercury_delete_coa_template: "coa",
  // Journal Entries
  mercury_create_journal_entry: "journal",
  mercury_update_journal_entry: "journal",
  mercury_delete_journal_entry: "journal",
};

const DEFAULT_LIMITS_PER_DAY: Record<string, number> = {
  money: 100,
  invoicing: 300,
  banking: 200,
  journal: 50,
  webhooks: 5,
  coa: 5,
};

interface ParsedRate {
  count: number;
  windowMs: number;
}

function parseRate(raw: string): ParsedRate | null {
  const m = raw.match(/^(\d+)\s*\/\s*(hour|day|week)$/i);
  if (!m) return null;
  const count = Number(m[1]);
  const unit = m[2].toLowerCase();
  const windowMs =
    unit === "hour" ? 3600_000 : unit === "day" ? 86400_000 : 604800_000;
  return { count, windowMs };
}

function getRateLimit(category: string): ParsedRate | null {
  const envKey = `MERCURY_MCP_RATE_LIMIT_${category}`;
  const raw = process.env[envKey];
  if (raw) {
    const parsed = parseRate(raw);
    if (parsed) return parsed;
    console.error(
      `Invalid rate limit format for ${envKey}: "${raw}" — expected like "100/day". Using default.`
    );
  }
  const defaultCount = DEFAULT_LIMITS_PER_DAY[category];
  if (defaultCount === undefined) return null;
  return { count: defaultCount, windowMs: 86400_000 };
}

interface CallRecord {
  ts: number;
}

const callHistory = new Map<string, CallRecord[]>();

/** Reset in-memory call history. Useful for tests. */
export function resetRateLimitHistory(): void {
  callHistory.clear();
}

export class RateLimitError extends Error {
  constructor(
    public toolName: string,
    public category: string,
    public limit: number,
    public windowMs: number,
    public retryAfterMs: number
  ) {
    const win =
      windowMs === 86400_000
        ? "day"
        : windowMs === 3600_000
        ? "hour"
        : `${Math.round(windowMs / 1000)}s`;
    const retrySec = Math.ceil(retryAfterMs / 1000);
    super(
      `Rate limit exceeded for ${toolName} (category: ${category}, limit: ${limit}/${win}). Retry in ${retrySec}s. ` +
        `Override with MERCURY_MCP_RATE_LIMIT_${category}=N/day if this is a legitimate batch.`
    );
    this.name = "RateLimitError";
  }
}

/**
 * Returns true if the call is allowed; throws RateLimitError otherwise.
 * Mutates internal call history if allowed.
 */
export function enforceRateLimit(toolName: string): void {
  if (process.env.MERCURY_MCP_RATE_LIMIT_disabled === "true") return;

  const category = TOOL_CATEGORIES[toolName];
  if (!category) return; // read tools or untracked → no limit

  const rl = getRateLimit(category);
  if (!rl) return;

  const now = Date.now();
  const records = (callHistory.get(category) ?? []).filter(
    (r) => now - r.ts < rl.windowMs
  );

  if (records.length >= rl.count) {
    const oldest = records[0];
    const retryAfterMs = rl.windowMs - (now - oldest.ts);
    throw new RateLimitError(toolName, category, rl.count, rl.windowMs, retryAfterMs);
  }

  records.push({ ts: now });
  callHistory.set(category, records);
}

export function isDryRun(): boolean {
  return process.env.MERCURY_MCP_DRY_RUN === "true";
}

export function logAudit(toolName: string, args: unknown, result: "ok" | "dry-run" | "error"): void {
  const path = process.env.MERCURY_MCP_AUDIT_LOG;
  if (!path) return;
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    tool: toolName,
    result,
    args,
  });
  // Best-effort append; ignore errors so audit failures never break the MCP
  import("node:fs").then((fs) => {
    fs.appendFile(path, entry + "\n", (err) => {
      if (err) console.error(`[audit] failed to write to ${path}:`, err.message);
    });
  });
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * Wrap a tool handler with rate limit, dry-run, and audit middleware.
 * - Rate limit: throws RateLimitError if exceeded
 * - Dry-run: returns a mock response without calling Mercury
 * - Audit log: writes structured entry to MERCURY_MCP_AUDIT_LOG if set
 */
export function wrapToolHandler<TArgs>(
  toolName: string,
  handler: (args: TArgs) => Promise<ToolResult>
): (args: TArgs) => Promise<ToolResult> {
  const isWriteOp = toolName in TOOL_CATEGORIES;

  return async (args: TArgs): Promise<ToolResult> => {
    if (isWriteOp) {
      try {
        enforceRateLimit(toolName);
      } catch (err) {
        if (err instanceof RateLimitError) {
          logAudit(toolName, args, "error");
          return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          };
        }
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
                wouldCallWith: args,
                note: "MERCURY_MCP_DRY_RUN=true; no actual Mercury API call was made.",
              },
              null,
              2
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
      throw err;
    }
  };
}
