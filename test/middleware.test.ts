import { enforceRateLimit, RateLimitError, isDryRun, wrapToolHandler, resetRateLimitHistory } from "../src/middleware.js";

describe("Middleware", () => {
  beforeEach(() => {
    delete process.env.MERCURY_MCP_DRY_RUN;
    delete process.env.MERCURY_MCP_RATE_LIMIT_disabled;
    delete process.env.MERCURY_MCP_RATE_LIMIT_webhooks;
    delete process.env.MERCURY_MCP_RATE_LIMIT_money;
    delete process.env.MERCURY_MCP_RATE_LIMIT_coa;
    delete process.env.MERCURY_MCP_RATE_LIMIT_journal;
    resetRateLimitHistory();
  });

  describe("enforceRateLimit", () => {
    it("does nothing for read tools (no category)", () => {
      expect(() => enforceRateLimit("mercury_list_accounts")).not.toThrow();
      // Many calls → still no throw
      for (let i = 0; i < 100; i++) enforceRateLimit("mercury_list_accounts");
    });

    it("respects MERCURY_MCP_RATE_LIMIT_disabled=true", () => {
      process.env.MERCURY_MCP_RATE_LIMIT_disabled = "true";
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

    it("invalid rate limit format falls back to default", () => {
      process.env.MERCURY_MCP_RATE_LIMIT_journal = "not-a-rate";
      // Should silently fall back to default (50/day) — first call OK
      expect(() => enforceRateLimit("mercury_create_journal_entry")).not.toThrow();
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
      process.env.MERCURY_MCP_RATE_LIMIT_coa = "1/day";
      const handler = jest.fn(async () => ({
        content: [{ type: "text" as const, text: "ok" }],
      }));
      const wrapped = wrapToolHandler("mercury_create_coa_template", handler);
      await wrapped({});
      const result2 = await wrapped({});
      expect(result2.isError).toBe(true);
      expect(result2.content[0].text).toContain("Rate limit exceeded");
    });
  });
});
