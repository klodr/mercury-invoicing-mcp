import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * AR (Accounts Receivable) prompts — Invoicing is the headline
 * differentiator of this MCP (vs the banking-only Mercury MCPs), so
 * the slash-command surface MUST cover the three core invoicing
 * workflows:
 *
 *   - /mercury-create-customer         → duplicate-check then
 *                                         mercury_create_customer
 *   - /mercury-create-invoice          → resolve customer + source
 *                                         deposit account, confirm,
 *                                         then mercury_create_invoice
 *                                         with one-or-more line items
 *   - /mercury-unpaid-invoices-overview → list_invoices filtered to
 *                                         Unpaid / Overdue, grouped
 *                                         and totalled
 *
 * None of these map to a `docs.mercury.com/recipes` entry (Mercury
 * only publishes banking recipes today), but they are the obvious
 * analogues for AR users and match the write-tool pairs already
 * registered in `src/tools/invoices.ts` + `customers.ts`.
 *
 * All three require the Mercury Plus plan for the underlying tools
 * to succeed — the prompts don't try to pre-check that, since the
 * 403 surface from the tools already carries a Plus hint.
 */

const CreateCustomerArgs = {
  name: z.string().min(1).describe("Customer legal name (business or individual)."),
  email: z
    .string()
    .email()
    .describe("Customer primary email — used for invoice delivery + payment-status notifications."),
  address: z
    .string()
    .optional()
    .describe(
      "Optional multi-line address string (street / city / state / postalCode / country). " +
        "The model parses it into the `address` sub-object before calling the tool; pass as a " +
        "plain string for simplicity.",
    ),
};

const CreateInvoiceArgs = {
  customerHint: z
    .string()
    .min(1)
    .describe(
      "Customer name or email substring (case-insensitive). The prompt looks this up in the " +
        "AR customer list BEFORE creating — it does not pre-resolve the UUID.",
    ),
  depositAccountHint: z
    .string()
    .optional()
    .describe(
      "Nickname / last-4 of the Mercury deposit account where the invoice payments should " +
        "land. Optional — if omitted, the model asks the user to pick from the account list.",
    ),
  amount: z
    .string()
    .min(1)
    .describe(
      "Single-line-item total in USD, as a decimal string (e.g. `1250.00`). If the user " +
        "wants multiple line items, they pass a free-form description and the model splits.",
    ),
  description: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "What the invoice is for — shown as the line-item description. Free-form; the model may " +
        "split into multiple line items if the text describes several distinct items.",
    ),
  dueInDays: z
    .string()
    .optional()
    .describe(
      "Due-date offset from today, in days (e.g. `30` for net-30). Defaults to 30. Must be a " +
        "positive integer as a string.",
    ),
  invoiceNumber: z
    .string()
    .max(255)
    .optional()
    .describe(
      "Customer-facing invoice number (e.g. `INV-2026-001`). Optional — Mercury assigns one " +
        "if omitted.",
    ),
  poNumber: z.string().optional().describe("Optional purchase-order number from the customer."),
};

const UnpaidInvoicesOverviewArgs = {
  customerHint: z
    .string()
    .optional()
    .describe("Optional customer-name substring to scope the overview to a single customer."),
};

export function registerInvoicingPrompts(server: McpServer): void {
  // --- /mercury-create-customer ---
  // Mirrors the /mercury-create-recipient structure (duplicate-check
  // before write) because a duplicate AR customer makes invoice
  // selection ambiguous in exactly the same way a duplicate
  // recipient does for payments.
  server.registerPrompt(
    "mercury-create-customer",
    {
      title: "Create an AR customer",
      description:
        "Duplicate-check the AR customer list, then call mercury_create_customer. Required for " +
        "mercury_create_invoice — you can only invoice a customer that already exists.",
      argsSchema: CreateCustomerArgs,
    },
    ({ name, email, address }) => ({
      description: `Create AR customer "${name}"`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Create a Mercury AR customer using the \`mercury_*\` tools.\n\n` +
              `1. Before creating anything, call \`mercury_list_customers\` and check for an ` +
              `existing customer whose name OR email matches the ones below. If a match is ` +
              `found, STOP and surface it — creating a duplicate AR customer will make ` +
              `invoice selection ambiguous in the Mercury Dashboard and is NOT what the user ` +
              `wants.\n` +
              `2. Call \`mercury_create_customer\` with:\n` +
              `   - name: "${name}"\n` +
              `   - email: "${email}"\n` +
              (address
                ? `   - address: <parse the string below into { street, city, state, postalCode, country }>\n` +
                  `     Source address: "${address}"\n` +
                  `     If the parsing is ambiguous, STOP and ask the user to confirm the ` +
                  `split rather than guessing.\n`
                : `   (no address supplied — will default to the workspace's on-file address)\n`) +
              `3. Report the new customer's UUID and display name back to the user, and ` +
              `confirm that the \`/mercury-create-invoice\` slash command is now usable ` +
              `against this customer. Do NOT immediately chain into invoice creation — that ` +
              `is a separate decision the user makes.`,
          },
        },
      ],
    }),
  );

  // --- /mercury-create-invoice ---
  // Irreversible-once-sent: Mercury defaults `sendEmailOption` to
  // `SendNow`, so a created invoice lands in the customer's inbox
  // unless the model explicitly overrides. The prompt surfaces that
  // choice up front and forces a confirmation before the call.
  server.registerPrompt(
    "mercury-create-invoice",
    {
      title: "Create and send an invoice",
      description:
        "Resolve customer + deposit account, confirm with the user, then call " +
        "mercury_create_invoice. Surfaces Mercury's default SendNow behaviour so the user " +
        "knows the invoice lands in the customer's inbox on confirmation.",
      argsSchema: CreateInvoiceArgs,
    },
    ({
      customerHint,
      depositAccountHint,
      amount,
      description,
      dueInDays,
      invoiceNumber,
      poNumber,
    }) => {
      // Reject `"0"` + non-numeric on dueInDays for the same reason
      // as `sinceDays` in the credit workflow: `"0"` would make the
      // invoice due today, which is almost certainly not what the
      // user meant. Fall back to net-30 on anything weird.
      const dueLabel = dueInDays && /^[1-9]\d*$/.test(dueInDays) ? dueInDays : "30";
      return {
        description: `Create ${amount} USD invoice for "${customerHint}" due in ${dueLabel} days`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Create a Mercury AR invoice using the \`mercury_*\` tools.\n\n` +
                `1. Call \`mercury_list_customers\` and find the one matching "${customerHint}" ` +
                `(case-insensitive on name + email). If no match is found, STOP and tell the ` +
                `user to run \`/mercury-create-customer\` first. If more than one matches, ` +
                `STOP and ask which one — do not guess.\n` +
                `2. Call \`mercury_list_accounts\` and resolve the deposit account.` +
                (depositAccountHint
                  ? ` Match against "${depositAccountHint}" on nickname / last-4 of account ` +
                    `number. If no unambiguous match, STOP and ask the user to pick.\n`
                  : ` Show the user the list and ask which account should receive the invoice ` +
                    `payments — do not pick for them.\n`) +
                `3. Compute:\n` +
                `   - invoiceDate: today in YYYY-MM-DD\n` +
                `   - dueDate: today + ${dueLabel} days in YYYY-MM-DD\n` +
                `4. Build one line item from the description "${description}" (free-form — ` +
                `if it describes multiple services, split into multiple line items with ` +
                `proportional amounts; if ambiguous, STOP and ask the user). Each line item ` +
                `needs \`{ description, quantity, unitAmount }\` where ` +
                `\`quantity * unitAmount\` sums to ${amount} USD across all line items.\n` +
                `5. Before calling \`mercury_create_invoice\`, echo a single-line ` +
                `confirmation:\n` +
                `   "Create invoice for ${amount} USD to <customer>, payable into <account>, ` +
                `due in ${dueLabel} days. Mercury will email the invoice to the customer ` +
                `immediately (sendEmailOption defaults to SendNow). Confirm?" and WAIT for ` +
                `an explicit yes.\n` +
                `6. Once confirmed, call \`mercury_create_invoice\` with:\n` +
                `   - customerId: <from step 1>\n` +
                `   - destinationAccountId: <from step 2>\n` +
                `   - invoiceDate: <from step 3>\n` +
                `   - dueDate: <from step 3>\n` +
                `   - lineItems: <from step 4>\n` +
                (invoiceNumber ? `   - invoiceNumber: "${invoiceNumber}"\n` : "") +
                (poNumber ? `   - poNumber: "${poNumber}"\n` : "") +
                `   (Leave \`sendEmailOption\` unset so Mercury uses its default \`SendNow\` — ` +
                `the user just confirmed that.)\n` +
                `7. Report the returned invoice ID, URL, and Mercury's rendered invoice ` +
                `number back to the user. Mention that the customer will receive the email ` +
                `within a minute or so.`,
            },
          },
        ],
      };
    },
  );

  // --- /mercury-unpaid-invoices-overview ---
  // Read-only: lists unpaid / overdue invoices grouped by age.
  // Deliberately does NOT send reminders — Mercury's automatic-
  // reminders toggle is a Dashboard-only setting today
  // (see ROADMAP → "Invoice automatic reminders flag").
  server.registerPrompt(
    "mercury-unpaid-invoices-overview",
    {
      title: "Overview of unpaid and overdue invoices",
      description:
        "List every Mercury invoice that is not yet fully paid, flagging overdue ones, and " +
        "print a total owed. Read-only: no reminders are sent, no invoices are cancelled.",
      argsSchema: UnpaidInvoicesOverviewArgs,
    },
    ({ customerHint }) => ({
      description: customerHint
        ? `Summarise unpaid invoices for customers matching "${customerHint}"`
        : "Summarise every unpaid and overdue invoice",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Produce a read-only unpaid-invoices report using the \`mercury_*\` tools:\n\n` +
              `1. Call \`mercury_list_invoices\` (no status filter — Mercury's statuses cover ` +
              `\`Draft | Open | Paid | Void | Uncollectible\`, so you will filter client-side ` +
              `to keep the logic simple).\n` +
              (customerHint
                ? `2. Scope to invoices whose \`customer.name\` or \`customer.email\` contains ` +
                  `"${customerHint}" (case-insensitive).\n`
                : `2. Keep every invoice.\n`) +
              `3. Keep only invoices with status \`Open\` (unpaid, not yet voided / paid).\n` +
              `4. For each remaining invoice, compute \`daysOverdue\` as today minus ` +
              `\`dueDate\` in days. Rows where \`daysOverdue > 0\` are OVERDUE.\n` +
              `5. Produce a single compact markdown table with one row per invoice and these ` +
              `columns: \`invoiceNumber\` | \`customer\` | \`dueDate\` | \`daysOverdue\` | ` +
              `\`amountDue (USD)\` | \`status\`. Sort by \`daysOverdue\` descending (most ` +
              `overdue first).\n` +
              `6. Below the table, print two lines:\n` +
              `   - "Total unpaid: <N> invoices, $<sum of amountDue>"\n` +
              `   - "Of which overdue: <M> invoices, $<sum of amountDue where daysOverdue > 0>"\n` +
              `7. Do NOT call any write tool — this is a status report. If the user wants to ` +
              `send a reminder for a specific overdue invoice, the only current path is the ` +
              `Mercury Dashboard (the Mercury API does not expose a per-invoice send-reminder ` +
              `endpoint; tracked in ROADMAP → "Invoice automatic reminders flag").`,
          },
        },
      ],
    }),
  );
}
