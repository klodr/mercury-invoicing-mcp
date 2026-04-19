import {
  enforceRateLimit,
  RateLimitError,
  isDryRun,
  wrapToolHandler,
  resetRateLimitHistory,
  redactSensitive,
  logAudit,
} from "../src/middleware.js";
import { MercuryError } from "../src/client.js";
import {
  chmodSync,
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Middleware", () => {
  let stateDir: string;

  beforeEach(() => {
    delete process.env.MERCURY_MCP_DRY_RUN;
    delete process.env.MERCURY_MCP_RATE_LIMIT_DISABLE;
    delete process.env.MERCURY_MCP_RATE_LIMIT_webhooks;
    delete process.env.MERCURY_MCP_RATE_LIMIT_money;
    delete process.env.MERCURY_MCP_RATE_LIMIT_invoicing;
    delete process.env.MERCURY_MCP_RATE_LIMIT_banking;
    stateDir = mkdtempSync(join(tmpdir(), "mercury-state-"));
    process.env.MERCURY_MCP_STATE_DIR = stateDir;
    resetRateLimitHistory();
  });

  afterEach(() => {
    delete process.env.MERCURY_MCP_STATE_DIR;
    rmSync(stateDir, { recursive: true, force: true });
  });

  describe("enforceRateLimit", () => {
    it("does nothing for read tools (no category)", () => {
      expect(() => enforceRateLimit("mercury_list_accounts")).not.toThrow();
      // Many calls → still no throw
      for (let i = 0; i < 100; i++) enforceRateLimit("mercury_list_accounts");
    });

    it("respects MERCURY_MCP_RATE_LIMIT_DISABLE=true", () => {
      process.env.MERCURY_MCP_RATE_LIMIT_DISABLE = "true";
      // Webhook default is 5/day, but disabled → unlimited
      for (let i = 0; i < 10; i++) {
        expect(() => enforceRateLimit("mercury_create_webhook")).not.toThrow();
      }
    });

    it("enforces custom env limit", () => {
      process.env.MERCURY_MCP_RATE_LIMIT_money = "2/day";
      enforceRateLimit("mercury_send_money");
      enforceRateLimit("mercury_send_money");
      expect(() => enforceRateLimit("mercury_send_money")).toThrow(RateLimitError);
    });

    it("RateLimitError contains useful info", () => {
      process.env.MERCURY_MCP_RATE_LIMIT_money = "1/day";
      enforceRateLimit("mercury_request_send_money"); // 1st OK
      try {
        enforceRateLimit("mercury_request_send_money"); // 2nd throws
        fail("Expected RateLimitError");
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        const e = err as RateLimitError;
        expect(e.toolName).toBe("mercury_request_send_money");
        expect(e.category).toBe("money");
        expect(e.limit).toBe(1);
        expect(e.message).toContain("Rate limit exceeded");
        expect(e.message).toContain("Override with MERCURY_MCP_RATE_LIMIT_money");
      }
    });

    it("invalid rate limit format logs a warning and falls back to default", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.MERCURY_MCP_RATE_LIMIT_invoicing = "not-a-rate";
      expect(() => enforceRateLimit("mercury_create_invoice")).not.toThrow();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid rate limit format for MERCURY_MCP_RATE_LIMIT_invoicing"),
      );
    });

    it("persists call history across simulated process restarts", () => {
      process.env.MERCURY_MCP_RATE_LIMIT_money = "2/day";
      enforceRateLimit("mercury_send_money");

      // Open the persisted state once and use fstat + read on the same fd
      // (avoids the path-based TOCTOU pattern that CodeQL flags).
      const stateFile = join(stateDir, "ratelimit.json");
      const fd = openSync(stateFile, "r");
      try {
        const stat = fstatSync(fd);
        expect(stat.mode & 0o777).toBe(0o600);
        const persisted = JSON.parse(readFileSync(fd, "utf8")) as Record<string, number[]>;
        expect(persisted.money).toHaveLength(1);
      } finally {
        closeSync(fd);
      }

      // Simulate restart: clear in-memory only, state file remains
      resetRateLimitHistory();
      enforceRateLimit("mercury_send_money"); // 2nd
      expect(() => enforceRateLimit("mercury_send_money")).toThrow(RateLimitError);
    });

    it("starts fresh when state file is corrupted", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.MERCURY_MCP_RATE_LIMIT_money = "1/day";
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "ratelimit.json"), "{not valid json");
      expect(() => enforceRateLimit("mercury_send_money")).not.toThrow();
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("corrupted state"));
    });

    it("ignores state files whose JSON shape is unexpected (array root)", () => {
      process.env.MERCURY_MCP_RATE_LIMIT_money = "1/day";
      mkdirSync(stateDir, { recursive: true });
      // JSON.parse succeeds but the type-guard on parsed-is-object rejects.
      writeFileSync(join(stateDir, "ratelimit.json"), "[1,2,3]");
      expect(() => enforceRateLimit("mercury_send_money")).not.toThrow();
    });

    it("skips entries whose value is not a number array", () => {
      process.env.MERCURY_MCP_RATE_LIMIT_money = "1/day";
      mkdirSync(stateDir, { recursive: true });
      // money entry is a number-array (loaded — needs a timestamp inside the
      // 1-day window so it actually counts), webhooks is a string (skipped
      // by the type-guard at middleware.ts:105).
      writeFileSync(
        join(stateDir, "ratelimit.json"),
        `{"money":[${Date.now()}],"webhooks":"not-an-array"}`,
      );
      // money already has 1 prior call → 2nd should hit the limit.
      expect(() => enforceRateLimit("mercury_send_money")).toThrow(RateLimitError);
    });

    it("supports the 'week' window in custom rate limits", () => {
      process.env.MERCURY_MCP_RATE_LIMIT_money = "1/week";
      enforceRateLimit("mercury_send_money");
      try {
        enforceRateLimit("mercury_send_money");
        fail("Expected RateLimitError");
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        // The week window doesn't have a short label — falls through to seconds.
        expect((err as RateLimitError).message).toMatch(/limit: 1\/\d+s\)/);
      }
    });

    it("logs (and does not throw) when the state file cannot be read", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.MERCURY_MCP_RATE_LIMIT_money = "1/day";
      // Existing state file with mode 0 → readFileSync raises EACCES (not ENOENT).
      mkdirSync(stateDir, { recursive: true });
      const stateFile = join(stateDir, "ratelimit.json");
      writeFileSync(stateFile, "{}");
      chmodSync(stateFile, 0o000);
      try {
        expect(() => enforceRateLimit("mercury_send_money")).not.toThrow();
      } finally {
        chmodSync(stateFile, 0o600);
      }
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/failed to read state from/));
    });

    it("does NOT clobber an unreadable state file when persisting", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.MERCURY_MCP_RATE_LIMIT_money = "1/day";
      // Pre-existing state file with prior counter, made unreadable mid-session.
      mkdirSync(stateDir, { recursive: true });
      const stateFile = join(stateDir, "ratelimit.json");
      const originalContent = '{"money":[1,2,3]}';
      writeFileSync(stateFile, originalContent);
      chmodSync(stateFile, 0o000);
      try {
        enforceRateLimit("mercury_send_money");
      } finally {
        chmodSync(stateFile, 0o600);
      }
      // The file must still hold the original counter — fail-closed on persist.
      expect(readFileSync(stateFile, "utf8")).toBe(originalContent);
    });

    it("logs (and does not throw) when the state file cannot be persisted", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.MERCURY_MCP_RATE_LIMIT_money = "1/day";
      // Pre-create the state dir read-only so writeFileSync(tmp) raises EACCES.
      mkdirSync(stateDir, { recursive: true });
      chmodSync(stateDir, 0o500);
      try {
        expect(() => enforceRateLimit("mercury_send_money")).not.toThrow();
      } finally {
        chmodSync(stateDir, 0o700);
      }
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/failed to persist state to/));
    });
  });

  describe("isDryRun", () => {
    it("returns false by default", () => {
      expect(isDryRun()).toBe(false);
    });

    it("returns true when MERCURY_MCP_DRY_RUN=true", () => {
      process.env.MERCURY_MCP_DRY_RUN = "true";
      expect(isDryRun()).toBe(true);
    });
  });

  describe("wrapToolHandler", () => {
    it("passes through read tool calls unchanged", async () => {
      const handler = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }));
      const wrapped = wrapToolHandler("mercury_list_accounts", handler);
      const result = await wrapped({});
      expect(result.content[0].text).toBe("ok");
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("returns dry-run response without calling handler when DRY_RUN=true", async () => {
      process.env.MERCURY_MCP_DRY_RUN = "true";
      const handler = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }));
      const wrapped = wrapToolHandler("mercury_create_invoice", handler);
      const result = await wrapped({ foo: "bar" });
      expect(handler).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain("dryRun");
      expect(result.content[0].text).toContain("mercury_create_invoice");
    });

    it("returns isError when rate limit is exceeded", async () => {
      process.env.MERCURY_MCP_RATE_LIMIT_webhooks = "1/day";
      const handler = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }));
      const wrapped = wrapToolHandler("mercury_create_webhook", handler);
      await wrapped({});
      const result2 = await wrapped({});
      expect(result2.isError).toBe(true);
      expect(result2.content[0].text).toContain("Rate limit exceeded");
    });

    it("converts MercuryError 403 on AR tool to isError with Plus-plan hint", async () => {
      const handler = vi.fn(async () => {
        throw new MercuryError("Forbidden", 403, { message: "subscription required" });
      });
      const wrapped = wrapToolHandler("mercury_create_invoice", handler);
      const result = await wrapped({ foo: "bar" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Mercury API error 403");
      expect(result.content[0].text).toContain(
        "Mercury's Invoicing/Customers API requires the Plus plan",
      );
    });

    it("converts MercuryError 403 on non-AR tool to isError without Plus-plan hint", async () => {
      const handler = vi.fn(async () => {
        throw new MercuryError("Forbidden", 403, {});
      });
      const wrapped = wrapToolHandler("mercury_send_money", handler);
      const result = await wrapped({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Mercury API error 403");
      expect(result.content[0].text).not.toContain("Plus plan");
    });

    it("converts MercuryError 500 to isError without hint", async () => {
      const handler = vi.fn(async () => {
        throw new MercuryError("Boom", 500, {});
      });
      const wrapped = wrapToolHandler("mercury_create_customer", handler);
      const result = await wrapped({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Mercury API error 500");
      expect(result.content[0].text).not.toContain("Plus plan");
    });

    it("re-throws non-Mercury errors unchanged", async () => {
      const handler = vi.fn(async () => {
        throw new Error("unexpected");
      });
      const wrapped = wrapToolHandler("mercury_create_invoice", handler);
      await expect(wrapped({})).rejects.toThrow("unexpected");
    });

    it("dry-run wouldCallWith redacts sensitive args", async () => {
      process.env.MERCURY_MCP_DRY_RUN = "true";
      const handler = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }));
      const wrapped = wrapToolHandler("mercury_add_recipient", handler);
      const result = await wrapped({
        name: "ACME",
        electronicRoutingInfo: { accountNumber: "1234567890", routingNumber: "021000021" },
      });
      const payload = result.content[0].text;
      expect(payload).toContain("[REDACTED]");
      expect(payload).not.toContain("1234567890");
      expect(payload).not.toContain("021000021");
    });
  });

  describe("redactSensitive", () => {
    it("redacts top-level sensitive keys (case-insensitive)", () => {
      expect(redactSensitive({ accountNumber: "1234", name: "Bob" })).toEqual({
        accountNumber: "[REDACTED]",
        name: "Bob",
      });
      expect(redactSensitive({ APIKey: "sk-xxx" })).toEqual({ APIKey: "[REDACTED]" });
      expect(redactSensitive({ Authorization: "Bearer abc" })).toEqual({
        Authorization: "[REDACTED]",
      });
    });

    it("recursively redacts nested objects", () => {
      const input = { wrapper: { creds: { password: "p@ss", username: "alice" } } };
      const out = redactSensitive(input) as {
        wrapper: { creds: { password: string; username: string } };
      };
      expect(out.wrapper.creds.password).toBe("[REDACTED]");
      expect(out.wrapper.creds.username).toBe("alice");
    });

    it("walks arrays", () => {
      const input = [{ token: "t1" }, { token: "t2", safe: "x" }];
      expect(redactSensitive(input)).toEqual([
        { token: "[REDACTED]" },
        { token: "[REDACTED]", safe: "x" },
      ]);
    });

    it("returns primitives and null unchanged", () => {
      expect(redactSensitive("plain")).toBe("plain");
      expect(redactSensitive(42)).toBe(42);
      expect(redactSensitive(null)).toBe(null);
      expect(redactSensitive(undefined)).toBe(undefined);
    });

    it("redacts ssn, secret, token at any depth", () => {
      const out = redactSensitive({
        a: { b: { ssn: "123-45-6789", secret: "s", token: "t" } },
      }) as {
        a: { b: { ssn: string; secret: string; token: string } };
      };
      expect(out.a.b.ssn).toBe("[REDACTED]");
      expect(out.a.b.secret).toBe("[REDACTED]");
      expect(out.a.b.token).toBe("[REDACTED]");
    });
  });

  describe("logAudit", () => {
    let tmpDir: string;
    let auditPath: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "mercury-audit-"));
      auditPath = join(tmpDir, "audit.log");
    });

    afterEach(() => {
      delete process.env.MERCURY_MCP_AUDIT_LOG;
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("does nothing when MERCURY_MCP_AUDIT_LOG is unset", () => {
      logAudit("mercury_send_money", { amount: 100 }, "ok");
      // No-op (no file path), no throw
    });

    it("writes redacted entry to absolute path with mode 0600", () => {
      process.env.MERCURY_MCP_AUDIT_LOG = auditPath;
      logAudit("mercury_add_recipient", { accountNumber: "1234567890" }, "ok");
      const content = readFileSync(auditPath, "utf8");
      expect(content).toContain("mercury_add_recipient");
      expect(content).toContain("[REDACTED]");
      expect(content).not.toContain("1234567890");
      expect(statSync(auditPath).mode & 0o777).toBe(0o600);
    });

    it("rejects relative paths and logs error", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.MERCURY_MCP_AUDIT_LOG = "relative/audit.log";
      logAudit("mercury_send_money", { amount: 1 }, "ok");
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("must be an absolute path"));
    });

    it("does not throw when write fails (best-effort)", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // Path inside a non-existent dir → ENOENT
      process.env.MERCURY_MCP_AUDIT_LOG = "/nonexistent-dir-mercury-test/audit.log";
      expect(() => logAudit("mercury_send_money", {}, "error")).not.toThrow();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("failed to write"),
        expect.any(String),
      );
    });
  });
});
