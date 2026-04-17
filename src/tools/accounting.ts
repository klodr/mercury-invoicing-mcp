import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MercuryClient } from "../client.js";

/**
 * Accounting tools: Chart of Accounts (COA) templates + Journal Entries.
 * Used by businesses that need detailed bookkeeping integration.
 */
export function registerAccountingTools(server: McpServer, client: MercuryClient): void {
  // === COA TEMPLATES ===

  server.tool(
    "mercury_list_coa_templates",
    "List Chart of Accounts (COA) templates configured in your Mercury workspace.",
    {},
    async () => {
      const data = await client.get("/coa-templates");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "mercury_get_coa_template",
    "Retrieve a specific COA template by ID.",
    { templateId: z.string().describe("COA template ID") },
    async ({ templateId }) => {
      const data = await client.get(`/coa-template/${templateId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "mercury_create_coa_template",
    "Create a new Chart of Accounts template.",
    {
      name: z.string().describe("Template name"),
      accounts: z
        .array(
          z.object({
            code: z.string(),
            name: z.string(),
            type: z.string().describe("e.g. 'asset', 'liability', 'equity', 'revenue', 'expense'"),
          })
        )
        .describe("Array of accounts in this template"),
    },
    async (args) => {
      const data = await client.post("/coa-templates", args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "mercury_update_coa_template",
    "Update an existing COA template.",
    {
      templateId: z.string(),
      name: z.string().optional(),
      accounts: z
        .array(z.object({ code: z.string(), name: z.string(), type: z.string() }))
        .optional(),
    },
    async ({ templateId, ...body }) => {
      const data = await client.patch(`/coa-template/${templateId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "mercury_delete_coa_template",
    "Delete a COA template.",
    { templateId: z.string() },
    async ({ templateId }) => {
      const data = await client.delete(`/coa-template/${templateId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // === JOURNAL ENTRIES ===

  server.tool(
    "mercury_list_journal_entries",
    "List journal entries (bookkeeping records) in your Mercury workspace.",
    {
      limit: z.number().int().min(1).max(500).optional(),
      start: z.string().optional().describe("Filter after this date (YYYY-MM-DD)"),
      end: z.string().optional().describe("Filter before this date (YYYY-MM-DD)"),
    },
    async (query) => {
      const data = await client.get("/journal-entries", query);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "mercury_get_journal_entry",
    "Retrieve a specific journal entry by ID.",
    { entryId: z.string().describe("Journal entry ID") },
    async ({ entryId }) => {
      const data = await client.get(`/journal-entry/${entryId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "mercury_create_journal_entry",
    "Create a new journal entry. Sum of debits must equal sum of credits.",
    {
      date: z.string().describe("Entry date (YYYY-MM-DD)"),
      memo: z.string().optional().describe("Entry description"),
      lines: z
        .array(
          z.object({
            accountCode: z.string().describe("COA account code (e.g. '1000', '4000')"),
            description: z.string().optional(),
            debit: z.number().nonnegative().optional(),
            credit: z.number().nonnegative().optional(),
          })
        )
        .min(2)
        .describe("Journal lines (at least 2). Each line must have either debit or credit."),
    },
    async (args) => {
      const data = await client.post("/journal-entries", args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "mercury_update_journal_entry",
    "Update an existing journal entry.",
    {
      entryId: z.string(),
      date: z.string().optional(),
      memo: z.string().optional(),
      lines: z
        .array(
          z.object({
            accountCode: z.string(),
            description: z.string().optional(),
            debit: z.number().nonnegative().optional(),
            credit: z.number().nonnegative().optional(),
          })
        )
        .optional(),
    },
    async ({ entryId, ...body }) => {
      const data = await client.patch(`/journal-entry/${entryId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "mercury_delete_journal_entry",
    "Delete a journal entry.",
    { entryId: z.string() },
    async ({ entryId }) => {
      const data = await client.delete(`/journal-entry/${entryId}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
