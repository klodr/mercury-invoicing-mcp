import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MercuryClient } from "../client.js";
import { registerAccountTools } from "./accounts.js";
import { registerCardTools } from "./cards.js";
import { registerCategoryTools } from "./categories.js";
import { registerOrganizationTools } from "./organization.js";
import { registerTransactionTools } from "./transactions.js";
import { registerRecipientTools } from "./recipients.js";
import { registerStatementTools } from "./statements.js";
import { registerTreasuryTools } from "./treasury.js";
import { registerInvoiceTools } from "./invoices.js";
import { registerCustomerTools } from "./customers.js";
import { registerWebhookTools } from "./webhooks.js";
import { registerAccountingTools } from "./accounting.js";

/**
 * Register all Mercury MCP tools on the server.
 * Tools are organized by domain.
 */
export function registerAllTools(server: McpServer, client: MercuryClient): void {
  // Banking
  registerAccountTools(server, client);
  registerCardTools(server, client);
  registerTransactionTools(server, client);
  registerRecipientTools(server, client);
  registerStatementTools(server, client);
  registerTreasuryTools(server, client);
  registerCategoryTools(server, client);
  registerOrganizationTools(server, client);

  // Accounts Receivable (Invoicing) — requires Mercury Plus
  registerInvoiceTools(server, client);
  registerCustomerTools(server, client);

  // Webhooks
  registerWebhookTools(server, client);

  // Accounting (COA + Journal Entries)
  registerAccountingTools(server, client);
}
