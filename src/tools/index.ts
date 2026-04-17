import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "../client.js";
import { registerAccountTools } from "./accounts.js";
import { registerTransactionTools } from "./transactions.js";
import { registerRecipientTools } from "./recipients.js";
import { registerStatementTools } from "./statements.js";
import { registerTreasuryTools } from "./treasury.js";
import { registerInvoiceTools } from "./invoices.js";
import { registerCustomerTools } from "./customers.js";

/**
 * Register all Mercury MCP tools on the server.
 * Tools are organized by domain (accounts, transactions, invoicing, etc.)
 */
export function registerAllTools(server: McpServer, client: MercuryClient): void {
  // Banking
  registerAccountTools(server, client);
  registerTransactionTools(server, client);
  registerRecipientTools(server, client);
  registerStatementTools(server, client);
  registerTreasuryTools(server, client);

  // Accounts Receivable (Invoicing)
  registerInvoiceTools(server, client);
  registerCustomerTools(server, client);
}
