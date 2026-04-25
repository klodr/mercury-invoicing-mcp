import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTool, textResult } from "./_shared.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

export function registerAccountTools(server: McpServer, client: MercuryClient): void {
  defineTool(
    server,
    "mercury_list_accounts",
    [
      "List all deposit bank accounts in your Mercury workspace (checking, savings, treasury).",
      "",
      "USE WHEN: enumerating Mercury bank accounts before drilling into transactions, balances, or statements. Typically the first call when you have an account ID in hand or need one.",
      "",
      "DO NOT USE: for IO Credit card accounts (use `mercury_list_credit_accounts` — `/credit` is a separate endpoint). For a single account whose ID is already known, prefer `mercury_get_account` to skip the list payload.",
      "",
      "SIDE EFFECTS: read-only. Counts toward Mercury's per-token rate limit.",
      "",
      "RETURNS: `{ accounts: [{ id, name, kind, status, availableBalance, currentBalance, accountNumber, routingNumber, ... }] }`.",
    ].join("\n"),
    {},
    async () => {
      const data = await client.get("/accounts");
      return textResult(data);
    },
  );

  defineTool(
    server,
    "mercury_get_account",
    [
      "Retrieve details for a specific Mercury deposit account by ID.",
      "",
      "USE WHEN: fetching the full detail of a single account whose ID is already known (typically from `mercury_list_accounts`). Faster than re-listing when you already have the ID.",
      "",
      "DO NOT USE: to enumerate accounts (use `mercury_list_accounts`). For IO Credit accounts (use the `mercury_list_credit_accounts` endpoint).",
      "",
      "SIDE EFFECTS: read-only. Counts toward Mercury's per-token rate limit.",
      "",
      "RETURNS: `{ id, name, kind, status, availableBalance, currentBalance, accountNumber, routingNumber, ... }`.",
    ].join("\n"),
    {
      accountId: z.string().uuid().describe("The Mercury account ID"),
    },
    async ({ accountId }) => {
      const data = await client.get(`/account/${accountId}`);
      return textResult(data);
    },
  );
}
