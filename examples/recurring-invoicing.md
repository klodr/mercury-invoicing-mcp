# Example: Setting up recurring monthly invoicing for a client

This example walks through using the MCP from a chat with Claude (or any MCP-aware client) to:

1. Create a customer
2. Create the first monthly invoice
3. Schedule it to be sent automatically

## Prerequisites

- Mercury account with the Invoicing API enabled (paid plan)
- Mercury API token with AR (accounts receivable) write scope
- This MCP server configured in your client (`MERCURY_API_KEY` set)

## 1. Create the customer

Tell your MCP-aware assistant:

> Create a Mercury customer for "Acme Corp" with email billing@acme.example.

The assistant will call:

```
mercury_create_customer(name="Acme Corp", email="billing@acme.example")
```

Mercury returns a customer object with `id` (UUID). Save this ID.

## 2. Create and send the first invoice

> Create an invoice for customer {customerId} for $150 of "Monthly retainer — May 2026", invoice date 2026-05-01, due 2026-05-15. Deposit to Mercury account {destinationAccountId}.

The assistant will call:

```
mercury_create_invoice(
  customerId="...",
  destinationAccountId="...",
  invoiceDate="2026-05-01",
  dueDate="2026-05-15",
  lineItems=[{ description: "Monthly retainer — May 2026", quantity: 1, unitPrice: 150.00 }],
  sendEmailOption="SendNow"
)
```

The customer immediately receives the invoice by email.

## 3. Programmatic recurring (cron-style)

The Mercury API itself does not have native recurring invoice scheduling, but you can drive it externally — e.g. a cron job, a GitHub Actions schedule, a workflow tool — that calls this MCP every month and runs the same `mercury_create_invoice` with updated dates.

A minimal workflow:

```text
1st of each month → trigger →
  for each customer in your "monthly retainer" list:
    mercury_create_invoice(...)
```

## 4. Tracking payments

```
mercury_list_invoices(limit=50, order="desc")
```

returns invoices with their statuses. Combine with `mercury_get_invoice(invoiceId)` for full details.

## 5. Cancelling or correcting

- Wrong line items? `mercury_update_invoice(invoiceId, lineItems=[...])` (works on draft invoices)
- Customer paid out-of-band? `mercury_cancel_invoice(invoiceId)`
