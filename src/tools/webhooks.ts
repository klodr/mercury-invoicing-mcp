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
        // `z.string().url()` rejects malformed URLs before this refine
        // runs, so `new URL()` cannot actually throw here. Kept
        // defensive in case the upstream validator changes.
        /* v8 ignore next */
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
        // Same reason as above: `new URL()` cannot throw at this
        // point because the upstream `.url()` check already rejected
        // malformed inputs.
        /* v8 ignore next */
        return false;
      }
      // Unwrap bracketed IPv6 literals. `URL().hostname` keeps the brackets
      // for IPv6 ([::1], [fe80::1]) — strip them before range checks.
      const host = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
      if (host === "localhost" || host === "::1") return false;

      // IPv4: match literal a.b.c.d and reject loopback (127/8),
      // link-local (169.254/16), and the RFC 1918 ranges. startsWith()
      // based checks were insufficient — "127.0.0.2" bypassed the old
      // exact-match on "127.0.0.1", and "10." matches "10." but not
      // correctly masks higher ranges. Numeric CIDR matching fixes both.
      const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (ipv4) {
        const a = Number(ipv4[1]);
        const b = Number(ipv4[2]);
        if (
          a === 0 || //                              0.0.0.0/8      "this host"/unspecified — some stacks resolve it to loopback
          a === 127 || //                            127.0.0.0/8    loopback
          a === 10 || //                             10.0.0.0/8     RFC 1918
          (a === 169 && b === 254) || //             169.254.0.0/16 link-local + cloud metadata
          (a === 192 && b === 168) || //             192.168.0.0/16 RFC 1918
          (a === 172 && b >= 16 && b <= 31) //       172.16.0.0/12  RFC 1918
        ) {
          return false;
        }
      }

      // IPv6 CIDR bitmask check on the first hextet:
      //   fc00::/7  → first 7 bits = 0b1111110 → mask 0xfe00, match 0xfc00
      //   fe80::/10 → first 10 bits = 0b1111111010 → mask 0xffc0, match 0xfe80
      // The old string-prefix check missed fe90..febf (still inside fe80::/10).
      // `String.split(":")[0]` always returns a defined string (possibly
      // empty), so the nullish-coalesce that used to sit here was dead
      // code and showed up as an uncovered branch on Codecov.
      const firstHextet = Number.parseInt(host.split(":")[0], 16);
      if (!Number.isNaN(firstHextet)) {
        if ((firstHextet & 0xfe00) === 0xfc00) return false; // fc00::/7 (ULA)
        if ((firstHextet & 0xffc0) === 0xfe80) return false; // fe80::/10 (link-local)
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
    [
      "List all webhook endpoints configured for your Mercury workspace.",
      "",
      "USE WHEN: enumerating registered webhook endpoints — for audit, finding a webhook ID before update/delete, or to confirm a delivery target is registered.",
      "",
      "DO NOT USE: to inspect webhook delivery history (Mercury exposes that only via the dashboard, not the API).",
      "",
      "RETURNS: `{ webhooks: [{ id, url, status, events, ... }] }`.",
    ].join("\n"),
    {},
    async () => {
      const data = await client.get("/webhooks");
      return textResult(data);
    },
    { title: "List Webhooks", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_get_webhook",
    [
      "Retrieve a specific webhook endpoint by ID.",
      "",
      "USE WHEN: fetching the full detail of one webhook (URL, current status, subscribed events) whose ID is already known.",
      "",
      "DO NOT USE: to enumerate webhooks (use `mercury_list_webhooks`).",
      "",
      "RETURNS: `{ id, url, status, events, ... }`.",
    ].join("\n"),
    {
      webhookId: z.string().uuid().describe("The webhook endpoint ID"),
    },
    async ({ webhookId }) => {
      const data = await client.get(`/webhooks/${webhookId}`);
      return textResult(data);
    },
    { title: "Get Webhook", readOnlyHint: true },
  );

  defineTool(
    server,
    "mercury_create_webhook",
    [
      "Register a new webhook endpoint. Mercury will POST events as JSON to the provided URL.",
      "",
      "USE WHEN: subscribing an external system to Mercury events (transaction.posted, invoice.paid, etc.) so you can react in near real-time without polling.",
      "",
      "DO NOT USE: with non-HTTPS URLs, loopback / RFC 1918 / link-local / cloud-metadata IPs — the MCP enforces a defense-in-depth gate on top of Mercury's own validation to block accidental SSRF or exfiltration via prompt injection.",
      "",
      "SIDE EFFECTS: writes a new webhook subscription to Mercury. Persistent. Once registered, Mercury immediately starts delivering matching events to your URL — make sure the endpoint is ready to receive (and ideally verify Mercury's signature). NOT idempotent at the API level — calling twice creates two subscriptions firing duplicate events.",
      "",
      "RETURNS: `{ id, url, status, events, ... }` — keep `id` for `mercury_update_webhook` / `mercury_delete_webhook`.",
    ].join("\n"),
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
    { title: "Create Webhook", destructiveHint: false },
  );

  defineTool(
    server,
    "mercury_update_webhook",
    [
      "Update an existing webhook endpoint (URL, status, or subscribed events).",
      "",
      'USE WHEN: rotating a webhook\'s destination URL, changing the event subscription, or reactivating a webhook Mercury auto-disabled after consecutive delivery failures (set `status: "active"`).',
      "",
      "DO NOT USE: to inspect delivery history. Same SSRF / non-HTTPS URL guard as `mercury_create_webhook` applies to the new URL.",
      "",
      "SIDE EFFECTS: overwrites the webhook record. Persistent. If `status` flips to `active`, Mercury resumes delivery on the next matching event. The new URL takes effect immediately for future events.",
      "",
      "RETURNS: `{ id, url, status, events, ... }` — the updated webhook.",
    ].join("\n"),
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
    { title: "Update Webhook", destructiveHint: false },
  );

  defineTool(
    server,
    "mercury_delete_webhook",
    [
      "Delete a webhook endpoint. **DESTRUCTIVE — Mercury stops delivering events to that URL.**",
      "",
      "USE WHEN: decommissioning a webhook (URL no longer reachable, integration retired, accidental duplicate). ALWAYS confirm with the user — there is no undo, and any downstream system that depended on the events stops being notified.",
      "",
      'DO NOT USE: to temporarily silence a webhook (use `mercury_update_webhook` with `status: "paused"` instead — reversible).',
      "",
      "SIDE EFFECTS: **permanent deletion** on Mercury's side. Future events that would have fired this webhook are silently dropped — no replay. Past delivery history is also lost from the Mercury dashboard.",
      "",
      "RETURNS: confirmation payload (`{ deleted: true, ... }` or similar).",
    ].join("\n"),
    {
      webhookId: z.string().uuid().describe("The webhook endpoint ID"),
    },
    async ({ webhookId }) => {
      const data = await client.delete(`/webhooks/${webhookId}`);
      return textResult(data);
    },
    { title: "Delete Webhook", destructiveHint: true },
  );
}
