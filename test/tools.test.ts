import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "../src/client.js";
import { registerAllTools } from "../src/tools/index.js";

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
