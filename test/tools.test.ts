import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "../src/client.js";
import { registerAllTools } from "../src/tools/index.js";
import { textResult } from "../src/tools/_shared.js";

function buildServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = new MercuryClient({ apiKey: "test-key" });
  registerAllTools(server, client);
  return server;
}

describe("registerAllTools", () => {
  it("registers without throwing", () => {
    expect(() => buildServer()).not.toThrow();
  });

  it("returns an McpServer instance", () => {
    const server = buildServer();
    expect(server).toBeInstanceOf(McpServer);
  });
});

describe("textResult", () => {
  it("returns sanitized JSON + structuredContent on a regular object", () => {
    const r = textResult({ id: "fax_abc", status: "delivered" });
    expect(JSON.parse(r.content[0]?.text ?? "")).toEqual({
      id: "fax_abc",
      status: "delivered",
    });
    expect(r.structuredContent).toEqual({ id: "fax_abc", status: "delivered" });
  });

  it("falls back to {} on structuredContent when the input sanitizes to null (defense-in-depth)", () => {
    // `sanitizeJsonValues(null)` returns null. MCP spec requires
    // structuredContent to be an object, so the `?? {}` fallback kicks in.
    const r = textResult(null);
    expect(r.content[0]?.text).toBe("null");
    expect(r.structuredContent).toEqual({});
  });

  it("falls back to {} when input sanitizes to undefined", () => {
    const r = textResult(undefined);
    expect(r.structuredContent).toEqual({});
  });
});
