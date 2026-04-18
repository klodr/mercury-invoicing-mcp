import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { MercuryClient } from "../client.js";

export function registerCategoryTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_categories",
    "List transaction categories available in your Mercury workspace (e.g. Office Supplies, Meals, Travel).",
    {},
    async () => {
      const data = await client.get("/categories");
      return textResult(data);
    },
  );
}
