import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { MercuryClient } from "../client.js";

export function registerOrganizationTools(server: McpServer, client: MercuryClient): void {
  defineTool(server, 
    "mercury_get_organization",
    "Retrieve information about your Mercury organization (company name, legal info, etc.).",
    {},
    async () => {
      const data = await client.get("/organization");
      return textResult(data);
    }
  );
}
