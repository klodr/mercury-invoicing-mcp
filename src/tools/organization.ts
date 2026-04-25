import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { MercuryClient } from "../client.js";

export function registerOrganizationTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_get_organization",
    [
      "Retrieve information about your Mercury organization (legal name, EIN, registered address, etc.).",
      "",
      "USE WHEN: fetching the workspace's legal identity for invoice generation, tax documents, or to confirm which organization the API token is bound to.",
      "",
      "DO NOT USE: for per-account info (use `mercury_get_account`). The Mercury API exposes only one organization per token, so there is no list variant.",
      "",
      "SIDE EFFECTS: read-only. Counts toward Mercury's per-token rate limit.",
      "",
      "RETURNS: `{ id, legalName, ein, address, ... }`.",
    ].join("\n"),
    {},
    async () => {
      const data = await client.get("/organization");
      return textResult(data);
    },
  );
}
