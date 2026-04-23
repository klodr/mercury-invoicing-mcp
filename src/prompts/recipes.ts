import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * User-facing prompts (slash commands) that bundle the tool sequences
 * documented in Mercury's public recipes
 * (https://docs.mercury.com/recipes) into ready-to-run templates.
 *
 * Prompts are USER-CONTROLLED per the MCP 2025-11-25 spec:
 * clients (Claude Desktop, Continue, Cursor, etc.) surface them as
 * slash commands so a human explicitly picks the workflow before the
 * LLM runs the tool chain. The prompt body names the `mercury_*`
 * tools verbatim and walks the model through the ordered API calls,
 * argument shapes, and confirmation gates — the LLM does not have to
 * re-discover them from the tool catalogue.
 *
 * Each prompt maps to a specific Mercury recipe:
 *   - /mercury-send-ach            → recipes/send-an-ach-payment
 *   - /mercury-create-recipient    → recipes/create-a-new-payment-recipient
 *   - /mercury-accounts-overview   → recipes/retrieve-information-about-all-of-your-accounts
 *   - /mercury-recipients-overview → recipes/retrieve-information-about-all-of-your-payment-recipients
 *
 * The two bulk-upload recipes (`bulk-upload-receipts`,
 * `bulk-upload-tax-docs`) are intentionally NOT exposed here: the
 * corresponding file-upload endpoints are not yet wrapped as MCP
 * tools in this server, so a prompt that named them would instruct
 * the LLM to call tools that do not exist. Once the upload tools
 * land, matching prompts can be added alongside.
 *
 * Separately, a `/mercury-pending-card-transactions` prompt is
 * tracked on its own PR alongside the `mercury_list_credit_accounts`
 * + `mercury_list_credit_transactions` tools it needs (the IO
 * Credit account lives behind undocumented endpoints that are not
 * reachable from `mercury_list_accounts` / `mercury_list_cards`).
 * See ROADMAP.md → "Mercury IO Credit account exposure".
 */

const SendAchArgs = {
  amount: z
    .string()
    .min(1)
    .describe(
      "Amount to send in USD, as a decimal string (e.g. `150.00`). The tool accepts a number " +
        "directly — keep the string shape here so clients with no numeric argument type pass " +
        "through cleanly.",
    ),
  recipientHint: z
    .string()
    .min(1)
    .describe(
      "Name, nickname, or partial match of the recipient. The model looks this up against " +
        "the existing recipient list before sending; the prompt does NOT pre-resolve.",
    ),
  sourceAccountHint: z
    .string()
    .optional()
    .describe(
      "Nickname / last-4 of the Mercury account to debit. Optional — if omitted, the model " +
        "asks the user to pick from the account list before sending.",
    ),
  externalMemo: z
    .string()
    .max(140)
    .optional()
    .describe("Memo shown on the recipient's statement (≤ 140 chars). Optional."),
};

const CreateRecipientArgs = {
  name: z.string().min(1).describe("Legal name of the recipient (business or individual)."),
  nickname: z
    .string()
    .optional()
    .describe("Short internal nickname shown in the Mercury UI (optional)."),
  contactEmail: z
    .string()
    .email()
    .describe("Primary contact email — required for the recipient-side payment notification."),
  routingNumber: z
    .string()
    .optional()
    .describe("ACH routing number (9 digits). Required to make the recipient eligible for ACH."),
  accountNumber: z
    .string()
    .optional()
    .describe("Bank account number. Required alongside routingNumber for ACH-eligible recipients."),
};

const AccountsOverviewArgs = {
  includeClosedAccounts: z
    .string()
    .optional()
    .describe(
      "Pass `true` to include closed accounts in the summary. Defaults to listing active " +
        "accounts only.",
    ),
};

const RecipientsOverviewArgs = {
  search: z
    .string()
    .optional()
    .describe("Optional name / nickname substring to filter the list before summarising."),
};

export function registerRecipePrompts(server: McpServer): void {
  // --- /mercury-send-ach ---
  // Mirrors docs.mercury.com/recipes/send-an-ach-payment: resolve the
  // source account + the recipient first, then `mercury_send_money`
  // with `paymentMethod: "ach"`. The prompt insists on an explicit
  // confirmation step because `mercury_send_money` is irreversible
  // once Mercury accepts the instruction.
  server.registerPrompt(
    "mercury-send-ach",
    {
      title: "Send an ACH payment",
      description:
        "Resolve source account + recipient, confirm with the user, then submit an ACH transfer " +
        "via mercury_send_money. Mirrors Mercury's `send-an-ach-payment` recipe.",
      argsSchema: SendAchArgs,
    },
    ({ amount, recipientHint, sourceAccountHint, externalMemo }) => ({
      description: `Send ${amount} USD via ACH to a recipient matching "${recipientHint}"`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Follow Mercury's "Send an ACH payment" recipe (` +
              `https://docs.mercury.com/recipes/send-an-ach-payment) using these ` +
              `\`mercury_*\` tools:\n\n` +
              `1. Call \`mercury_list_recipients\` and find the one that matches ` +
              `"${recipientHint}" (case-insensitive on name + nickname). If more than one ` +
              `recipient matches, STOP and ask the user which one they mean — do not guess.\n` +
              `2. Verify the chosen recipient has the ACH payment method enabled. If its ` +
              `bank details are missing, STOP and tell the user to run ` +
              `\`/mercury-create-recipient\` (or \`mercury_add_recipient\` directly) first.\n` +
              `3. Call \`mercury_list_accounts\` to resolve the source account.` +
              (sourceAccountHint
                ? ` Match against "${sourceAccountHint}" on nickname / last-4 of account ` +
                  `number. If no unambiguous match, STOP and ask the user to pick.\n`
                : ` Show the user the list and ask which account to debit — do not pick for ` +
                  `them.\n`) +
              `4. Before calling \`mercury_send_money\`, echo a single-line confirmation:\n` +
              `   "Send ${amount} USD via ACH from <account> to <recipient>` +
              (externalMemo ? ` with memo \\"${externalMemo}\\"` : "") +
              `. Confirm?" and WAIT for an explicit yes.\n` +
              `5. Once confirmed, call \`mercury_send_money\` with:\n` +
              `   - accountId: <source account UUID>\n` +
              `   - recipientId: <recipient UUID>\n` +
              `   - amount: ${amount}  (numeric; coerce from the string input)\n` +
              `   - paymentMethod: "ach"\n` +
              (externalMemo ? `   - externalMemo: "${externalMemo}"\n` : "") +
              `   - idempotencyKey: <new UUID, so a retry of the same confirmation does not ` +
              `duplicate the transfer>\n` +
              `6. Report the returned transaction ID, amount, and estimated arrival date back ` +
              `to the user. ACH transfers typically settle in 1–3 business days — note that in ` +
              `the reply so the user does not expect an instant balance change.`,
          },
        },
      ],
    }),
  );

  // --- /mercury-create-recipient ---
  // Mirrors docs.mercury.com/recipes/create-a-new-payment-recipient.
  // The recipe in the upstream docs also walks through enabling the
  // ACH payment method — we fold that step in here so a fresh
  // recipient is ready for `mercury-send-ach` without a follow-up
  // update.
  server.registerPrompt(
    "mercury-create-recipient",
    {
      title: "Create a new payment recipient",
      description:
        "Create a Mercury payment recipient and (when routing + account numbers are supplied) " +
        "configure it for ACH. Mirrors Mercury's `create-a-new-payment-recipient` recipe.",
      argsSchema: CreateRecipientArgs,
    },
    ({ name, nickname, contactEmail, routingNumber, accountNumber }) => ({
      description: `Create Mercury recipient "${name}"`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Follow Mercury's "Create a new payment recipient" recipe (` +
              `https://docs.mercury.com/recipes/create-a-new-payment-recipient).\n\n` +
              `1. Before creating anything, call \`mercury_list_recipients\` and check for an ` +
              `existing recipient whose name, nickname, or contact email matches the ones ` +
              `below. If a match is found, STOP and surface it — creating a duplicate makes ` +
              `the payment UI ambiguous and is NOT what the user wants.\n` +
              `2. Call \`mercury_add_recipient\` with:\n` +
              `   - name: "${name}"\n` +
              (nickname ? `   - nickname: "${nickname}"\n` : "") +
              `   - emails: ["${contactEmail}"]\n` +
              (routingNumber && accountNumber
                ? `   - defaultPaymentMethod: "domesticAch"\n` +
                  `   - electronicRoutingInfo: {\n` +
                  `       electronicAccountType: "businessChecking",\n` +
                  `       routingNumber: "${routingNumber}",\n` +
                  `       accountNumber: "${accountNumber}",\n` +
                  `       bankName: <look up from the routing number or ask the user>,\n` +
                  `     }\n`
                : `   (No bank details supplied — the recipient is created as a "contact-only" ` +
                  `record. A follow-up \`mercury_update_recipient\` will be required before ` +
                  `ACH can be sent.)\n`) +
              `3. Report the new recipient's UUID and nickname back to the user. If ACH was ` +
              `configured, confirm that \`/mercury-send-ach\` is now usable against this ` +
              `recipient. Otherwise, tell the user that bank details are still needed.`,
          },
        },
      ],
    }),
  );

  // --- /mercury-accounts-overview ---
  // Mirrors docs.mercury.com/recipes/retrieve-information-about-all-of-your-accounts.
  // A read-only roll-up — no confirmation gate because nothing is
  // mutated.
  server.registerPrompt(
    "mercury-accounts-overview",
    {
      title: "Overview of all Mercury accounts",
      description:
        "List every Mercury account with balance + status in a single compact table. Mirrors " +
        "Mercury's `retrieve-information-about-all-of-your-accounts` recipe.",
      argsSchema: AccountsOverviewArgs,
    },
    ({ includeClosedAccounts }) => ({
      description: "Summarise every Mercury account",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Follow Mercury's "Retrieve information about all of your accounts" recipe (` +
              `https://docs.mercury.com/recipes/retrieve-information-about-all-of-your-accounts` +
              `).\n\n` +
              `1. Call \`mercury_list_accounts\`.\n` +
              `2. ${
                includeClosedAccounts === "true"
                  ? "Keep every account in the list, including closed ones."
                  : 'Filter out accounts with status "archived" or "closed" before presenting.'
              }\n` +
              `3. Produce a single compact markdown table with one row per account and these ` +
              `columns: \`nickname\` | \`type\` | \`status\` | \`availableBalance\` | ` +
              `\`currentBalance\` | \`routingNumber\` (last 4 of account). Sort by ` +
              `\`availableBalance\` descending so the highest-balance accounts sit at the top.\n` +
              `4. Below the table, print a one-line total: "Total available across <N> active ` +
              `accounts: $<sum>".\n` +
              `5. Do NOT call \`mercury_get_account\` per account unless the user explicitly ` +
              `asks for extra per-account details — \`mercury_list_accounts\` already returns ` +
              `the fields in the table above.`,
          },
        },
      ],
    }),
  );

  // --- /mercury-recipients-overview ---
  // Mirrors docs.mercury.com/recipes/retrieve-information-about-all-of-your-payment-recipients.
  // Surfaces which recipients are ACH-ready vs incomplete, so the
  // user can queue `/mercury-send-ach` without a dead-end lookup.
  server.registerPrompt(
    "mercury-recipients-overview",
    {
      title: "Overview of all Mercury payment recipients",
      description:
        "List every Mercury recipient, flagging which are ACH-ready vs missing bank details. " +
        "Mirrors Mercury's `retrieve-information-about-all-of-your-payment-recipients` recipe.",
      argsSchema: RecipientsOverviewArgs,
    },
    ({ search }) => ({
      description: search
        ? `Summarise Mercury recipients matching "${search}"`
        : "Summarise every Mercury recipient",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Follow Mercury's "Retrieve information about all of your payment recipients" ` +
              `recipe (` +
              `https://docs.mercury.com/recipes/retrieve-information-about-all-of-your-` +
              `payment-recipients).\n\n` +
              `1. Call \`mercury_list_recipients\`.\n` +
              (search
                ? `2. Filter the list case-insensitively on name + nickname + emails, keeping ` +
                  `only rows matching "${search}".\n`
                : `2. Keep every recipient.\n`) +
              `3. Produce a compact markdown table with one row per recipient and these ` +
              `columns: \`name\` | \`nickname\` | \`defaultPaymentMethod\` | \`ach-ready\` | ` +
              `\`contactEmail\`. A recipient is \`ach-ready\` when it has a populated ` +
              `\`electronicRoutingInfo\` (routing + account number). Sort alphabetically by ` +
              `\`name\`.\n` +
              `4. Below the table, print two counts: "<N> ACH-ready" and "<M> missing bank ` +
              `details — run \`/mercury-create-recipient\` or \`mercury_update_recipient\` to ` +
              `complete them".\n` +
              `5. Do NOT call any write tool — this is a read-only report.`,
          },
        },
      ],
    }),
  );
}
