import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { MercuryClient } from "../client.js";

export function registerCategoryTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_categories",
    [
      "List transaction categories available in your Mercury workspace (e.g. Office Supplies, Meals, Travel).",
      "",
      "USE WHEN: discovering valid `categoryId` values before calling `mercury_update_transaction` to recategorise a transaction. Also useful for category-based reporting in downstream tooling.",
      "",
      "DO NOT USE: to list transactions in a category (use `mercury_list_transactions` and filter client-side). Category creation/edit is not exposed by this MCP — the Mercury API does not currently support it.",
      "",
      "RETURNS: `{ categories: [{ id, name, ... }] }`.",
    ].join("\n"),
    {},
    async () => {
      const data = await client.get("/categories");
      return textResult(data);
    },
  );
}
