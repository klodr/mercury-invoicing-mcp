import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerCardTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_cards",
    [
      "List physical and virtual cards attached to a Mercury account.",
      "",
      "USE WHEN: enumerating cards (debit, virtual debit, IO Credit) issued against an account — for spend audits, freezing review, or cardholder lookups.",
      "",
      "DO NOT USE: to list IO Credit transactions (use `mercury_list_credit_transactions`). Card creation, freezing, and PIN ops are not exposed by this MCP — the Mercury API does not currently support them.",
      "",
      "SIDE EFFECTS: read-only. Counts toward Mercury's per-token rate limit.",
      "",
      "RETURNS: `{ cards: [{ id, last4, type, status, holderName, expiry, ... }] }`.",
    ].join("\n"),
    {
      accountId: z.string().uuid().describe("The Mercury account ID"),
    },
    async ({ accountId }) => {
      const data = await client.get(`/account/${accountId}/cards`);
      return textResult(data);
    },
  );
}
