import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
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
  defineTool(
    server,
    "mercury_list_webhooks",
    "List all webhook endpoints configured for your Mercury account.",
    {},
    async () => {
      const data = await client.get("/webhooks");
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_get_webhook",
    "Retrieve a specific webhook endpoint by ID.",
    {
      webhookId: z.string().uuid().describe("The webhook endpoint ID"),
    },
    async ({ webhookId }) => {
      const data = await client.get(`/webhooks/${webhookId}`);
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_create_webhook",
    "Register a new webhook endpoint. Mercury will POST events as JSON to the provided URL.",
    {
      url: z.string().url().describe("HTTPS URL that will receive webhook events (POST)"),
      events: z.array(z.string()).describe(eventTypesDescription),
    },
    async ({ url, events }) => {
      const data = await client.post("/webhooks", { url, events });
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_update_webhook",
    "Update an existing webhook endpoint (URL, status, or events). Mercury endpoint is POST /webhooks/{id}. A webhook disabled after consecutive failures can be reactivated by setting status to 'active'.",
    {
      webhookId: z.string().uuid().describe("The webhook endpoint ID"),
      url: z.string().url().optional().describe("New HTTPS URL"),
      status: z.enum(["active", "paused"]).optional().describe("Webhook status"),
      eventTypes: z.array(z.string()).optional().describe(eventTypesDescription),
    },
    async ({ webhookId, ...body }) => {
      const data = await client.post(`/webhooks/${webhookId}`, body);
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_delete_webhook",
    "Delete a webhook endpoint.",
    {
      webhookId: z.string().uuid().describe("The webhook endpoint ID"),
    },
    async ({ webhookId }) => {
      const data = await client.delete(`/webhooks/${webhookId}`);
      return textResult(data);
    },
  );
}
