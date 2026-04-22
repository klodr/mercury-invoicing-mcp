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

/**
 * Webhook URL validator — HTTPS only, public hostnames only.
 *
 * Defense-in-depth layer. Mercury almost certainly runs its own
 * URL checks upstream (HTTPS enforcement, signed payloads per
 * https://docs.mercury.com/reference/webhooks — payload follows
 * JSON Merge Patch RFC 7396, typically signed to prove origin),
 * but relying only on upstream validation means a prompt-injected
 * request first reaches Mercury with a hostile URL before anything
 * gets rejected. Validating at the MCP boundary stops those requests
 * from being issued in the first place, keeps exfiltration attempts
 * out of Mercury's audit trail, and makes the failure message visible
 * to the operator rather than buried in a generic 400 from upstream.
 *
 * Rationale for the specific rules:
 *
 *   - HTTPS required: a prompt-injected agent that can reach the
 *     write API of this MCP could otherwise register a webhook toward
 *     `http://attacker.tld` and siphon every subsequent Mercury event
 *     (transactions, invoices, balances) in clear. The
 *     `webhooks_create: 2/day` rate limit is not a real brake here —
 *     two endpoints are more than enough to exfiltrate. The old
 *     `z.string().url()` accepted `http://`, `file://`, `data:`,
 *     `ftp://`, etc.; the description said "HTTPS" but the validator
 *     did not enforce it.
 *
 *   - Loopback / RFC 1918 / link-local / cloud-metadata / private IPv6
 *     blocked: guards against operator misconfiguration (e.g. a
 *     webhook accidentally pointing at `https://169.254.169.254/...`)
 *     and against prompt injections that try to bounce through an
 *     internal service. Mercury's own retries would not reach those
 *     targets from the outside anyway, so this rule costs the caller
 *     nothing legitimate.
 */
const HttpsWebhookUrl = z
  .string()
  .url()
  .refine(
    (raw) => {
      try {
        return new URL(raw).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Webhook URL must use https:// (http, file, data, ftp, etc. are rejected)" },
  )
  .refine(
    (raw) => {
      let h: string;
      try {
        h = new URL(raw).hostname.toLowerCase();
      } catch {
        return false;
      }
      if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
      if (h.startsWith("169.254.")) return false; // link-local + AWS/GCP/Azure metadata
      if (h.startsWith("10.")) return false; // RFC 1918 private
      if (h.startsWith("192.168.")) return false; // RFC 1918 private
      // RFC 1918: 172.16.0.0 – 172.31.255.255
      if (h.startsWith("172.")) {
        const second = Number(h.split(".")[1]);
        if (second >= 16 && second <= 31) return false;
      }
      // IPv6: fc00::/7 (ULA) and fe80::/10 (link-local)
      if (h.startsWith("[")) {
        const v6 = h.slice(1, -1);
        if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80:")) return false;
      }
      return true;
    },
    {
      message:
        "Webhook URL must be publicly reachable. Loopback, RFC 1918 private, link-local, cloud-metadata, and private IPv6 ranges are rejected to prevent data exfiltration and SSRF.",
    },
  );

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
    "Register a new webhook endpoint. Mercury will POST events as JSON to the provided URL. URL MUST use https:// on a publicly reachable host.",
    {
      url: HttpsWebhookUrl.describe(
        "Publicly reachable HTTPS URL that will receive webhook events (POST). Must not be a loopback, private, or link-local address.",
      ),
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
      url: HttpsWebhookUrl.optional().describe(
        "New publicly reachable HTTPS URL (same rules as mercury_create_webhook).",
      ),
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
