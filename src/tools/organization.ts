import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "../client.js";

export function registerOrganizationTools(server: McpServer, client: MercuryClient): void {
  server.tool(
    "mercury_get_organization",
    "Retrieve information about your Mercury organization (company name, legal info, etc.).",
    {},
    async () => {
      const data = await client.get("/organization");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
