import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "../client.js";
import { registerAccountTools } from "./accounts.js";

/**
 * Register all Mercury MCP tools on the server.
 * Tools are organized by domain (accounts, transactions, invoicing, etc.)
 */
export function registerAllTools(server: McpServer, client: MercuryClient): void {
  registerAccountTools(server, client);
  // registerTransactionTools(server, client);
  // registerRecipientTools(server, client);
  // registerInvoicingTools(server, client);
  // registerCustomerTools(server, client);
}
