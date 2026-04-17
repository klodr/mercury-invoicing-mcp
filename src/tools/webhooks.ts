import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

const eventTypesDescription = `Event types to subscribe to. Common values:
- transaction.created / transaction.updated
- transaction.posted / transaction.pending / transaction.failed
- invoice.created / invoice.sent / invoice.paid / invoice.overdue / invoice.cancelled
- customer.created / customer.updated
- recipient.created / recipient.updated
Check https://docs.mercury.com/reference/webhooks for the full list.`;

export function registerWebhookTools(server: McpServer, client: MercuryClient): void {
  server.tool(
    "mercury_list_webhooks",
    "List all webhook endpoints configured for your Mercury account.",
    {},
    async () => {
      const data = await client.get("/webhooks");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "mercury_get_webhook",
    "Retrieve a specific webhook endpoint by ID.",
    {
      webhookId: z.string().describe("The webhook endpoint ID"),
    },
    async ({ webhookId }) => {
      const data = await client.get(`/webhooks/${webhookId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "mercury_create_webhook",
    "Register a new webhook endpoint. Mercury will POST events as JSON to the provided URL.",
    {
      url: z.string().url().describe("HTTPS URL that will receive webhook events (POST)"),
      events: z.array(z.string()).describe(eventTypesDescription),
    },
    async ({ url, events }) => {
      const data = await client.post("/webhooks", { url, events });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // Note: Mercury does not expose update_webhook via the API (PATCH and PUT
  // both return 405). To change a webhook, delete + create instead.

  server.tool(
    "mercury_delete_webhook",
    "Delete a webhook endpoint.",
    {
      webhookId: z.string().describe("The webhook endpoint ID"),
    },
    async ({ webhookId }) => {
      const data = await client.delete(`/webhooks/${webhookId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
