import { enforceRateLimit, RateLimitError, isDryRun, wrapToolHandler, resetRateLimitHistory, redactSensitive, logAudit } from "../src/middleware.js";
import { MercuryError } from "../src/client.js";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Middleware", () => {
  beforeEach(() => {
    delete process.env.MERCURY_MCP_DRY_RUN;
    delete process.env.MERCURY_MCP_RATE_LIMIT_DISABLE;
    delete process.env.MERCURY_MCP_RATE_LIMIT_webhooks;
    delete process.env.MERCURY_MCP_RATE_LIMIT_money;
    delete process.env.MERCURY_MCP_RATE_LIMIT_invoicing;
    delete process.env.MERCURY_MCP_RATE_LIMIT_banking;
    resetRateLimitHistory();
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
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      process.env.MERCURY_MCP_RATE_LIMIT_invoicing = "not-a-rate";
      expect(() => enforceRateLimit("mercury_create_invoice")).not.toThrow();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid rate limit format for MERCURY_MCP_RATE_LIMIT_invoicing"),
      );
      errSpy.mockRestore();
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
      const handler = jest.fn(async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }));
      const wrapped = wrapToolHandler("mercury_list_accounts", handler);
      const result = await wrapped({});
      expect(result.content[0].text).toBe("ok");
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("returns dry-run response without calling handler when DRY_RUN=true", async () => {
      process.env.MERCURY_MCP_DRY_RUN = "true";
      const handler = jest.fn(async () => ({
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
      const handler = jest.fn(async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }));
      const wrapped = wrapToolHandler("mercury_create_webhook", handler);
      await wrapped({});
      const result2 = await wrapped({});
      expect(result2.isError).toBe(true);
      expect(result2.content[0].text).toContain("Rate limit exceeded");
    });

    it("converts MercuryError 403 on AR tool to isError with Plus-plan hint", async () => {
      const handler = jest.fn(async () => {
        throw new MercuryError("Forbidden", 403, { message: "subscription required" });
      });
      const wrapped = wrapToolHandler("mercury_create_invoice", handler);
      const result = await wrapped({ foo: "bar" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Mercury API error 403");
      expect(result.content[0].text).toContain("Mercury's Invoicing/Customers API requires the Plus plan");
    });

    it("converts MercuryError 403 on non-AR tool to isError without Plus-plan hint", async () => {
      const handler = jest.fn(async () => {
        throw new MercuryError("Forbidden", 403, {});
      });
      const wrapped = wrapToolHandler("mercury_send_money", handler);
      const result = await wrapped({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Mercury API error 403");
      expect(result.content[0].text).not.toContain("Plus plan");
    });

    it("converts MercuryError 500 to isError without hint", async () => {
      const handler = jest.fn(async () => {
        throw new MercuryError("Boom", 500, {});
      });
      const wrapped = wrapToolHandler("mercury_create_customer", handler);
      const result = await wrapped({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Mercury API error 500");
      expect(result.content[0].text).not.toContain("Plus plan");
    });

    it("re-throws non-Mercury errors unchanged", async () => {
      const handler = jest.fn(async () => {
        throw new Error("unexpected");
      });
      const wrapped = wrapToolHandler("mercury_create_invoice", handler);
      await expect(wrapped({})).rejects.toThrow("unexpected");
    });

    it("dry-run wouldCallWith redacts sensitive args", async () => {
      process.env.MERCURY_MCP_DRY_RUN = "true";
      const handler = jest.fn(async () => ({
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
      const out = redactSensitive(input) as { wrapper: { creds: { password: string; username: string } } };
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
      const out = redactSensitive({ a: { b: { ssn: "123-45-6789", secret: "s", token: "t" } } }) as {
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
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      process.env.MERCURY_MCP_AUDIT_LOG = "relative/audit.log";
      logAudit("mercury_send_money", { amount: 1 }, "ok");
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("must be an absolute path"),
      );
      errSpy.mockRestore();
    });

    it("does not throw when write fails (best-effort)", () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      // Path inside a non-existent dir → ENOENT
      process.env.MERCURY_MCP_AUDIT_LOG = "/nonexistent-dir-mercury-test/audit.log";
      expect(() => logAudit("mercury_send_money", {}, "error")).not.toThrow();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("failed to write"),
        expect.any(String),
      );
      errSpy.mockRestore();
    });
  });
});
