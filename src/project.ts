/**
 * Payload projection for transaction list endpoints.
 *
 * Transaction lists are by far the heaviest surface this server
 * exposes. Mercury returns up to 500 transactions per call, and every
 * transaction carrying a receipt embeds a **pre-signed S3 URL of
 * ~2.4 kB** — the signature, security token, and credential scope make
 * a single `attachments` entry larger than the rest of the transaction
 * put together. A 500-transaction sweep can run to several hundred
 * kilobytes, most of it URLs that are useless until the moment you
 * actually download one.
 *
 * So list tools project down to the fields you need to *identify* a
 * transaction — date, amount, counterparty, category, and whether a
 * receipt exists at all. `detail: "full"` restores every Mercury field
 * when a caller genuinely needs them in bulk.
 *
 * **No transaction payload ever carries the URL**, in either mode. A
 * pre-signed URL is a bearer credential with a 12-hour life: anyone
 * holding it downloads the receipt, no authentication asked. Emitting
 * one on every transaction read would spray short-lived credentials
 * through model context, transcripts, and audit logs for the sake of a
 * download that almost never happens. Callers who want the file ask for
 * it by name via `mercury_get_transaction_attachment`, one transaction
 * at a time and on purpose.
 */

/** Whether a list tool returns the projected shape or Mercury's raw one. */
export type Detail = "compact" | "full";

/**
 * Fields kept verbatim in compact mode. Chosen so a caller can
 * identify, date, categorise, and reconcile a transaction without a
 * second round-trip.
 */
const KEPT_FIELDS = [
  "id",
  "amount",
  "status",
  "kind",
  "postedAt",
  // `createdAt` is not listed here: on settled transactions it tracks
  // `postedAt` within seconds, so a second ISO timestamp costs ~30 bytes
  // per row for no reconciliation value. It is restored below when
  // `postedAt` is absent — pending card authorisations have not posted
  // yet, and `createdAt` is then their only timestamp.
  // `counterpartyId` stays: it is the join key onto an accounting
  // system's partner records.
  "counterpartyId",
  "counterpartyName",
  "bankDescription",
  "note",
  "externalMemo",
  "mercuryCategory",
  "cardId",
  "checkNumber",
  "failedAt",
  "reasonForFailure",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Project one transaction to its compact shape.
 *
 * `attachments` collapses to the single fact a list view needs:
 * `hasAttachment`, is a receipt on file or not. It is emitted even when
 * false — the question this answers in practice is "which transactions
 * are still missing their supporting document", and you cannot filter
 * on a key that is absent. `categoryData` collapses to `categoryName`.
 *
 * Unknown fields are dropped rather than passed through: Mercury adds
 * fields over time and a passthrough would quietly re-inflate the
 * payload the next time they ship one.
 */
export function compactTransaction(tx: unknown): unknown {
  if (!isRecord(tx)) return tx;

  const out: Record<string, unknown> = {};
  for (const field of KEPT_FIELDS) {
    if (tx[field] !== undefined && tx[field] !== null) {
      out[field] = tx[field];
    }
  }

  // A pending card authorisation has not posted, so `postedAt` is
  // absent and `createdAt` is the only date it carries. Dropping both
  // would leave the row undatable — and `status: "pending"` is a
  // supported filter, so these rows are asked for on purpose.
  if (out["postedAt"] === undefined && tx["createdAt"] !== undefined && tx["createdAt"] !== null) {
    out["createdAt"] = tx["createdAt"];
  }

  const category = tx["categoryData"];
  if (isRecord(category) && typeof category["name"] === "string") {
    out["categoryName"] = category["name"];
  }

  const attachments = tx["attachments"];
  out["hasAttachment"] = Array.isArray(attachments) && attachments.length > 0;

  return out;
}

/**
 * Strip pre-signed URLs from a transaction's `attachments`, keeping the
 * file name and type so a caller still knows what is on file.
 *
 * Applied even in `detail: "full"` mode and on single-transaction
 * reads: "full" means every *field* Mercury returns, not a licence to
 * leak a bearer credential. `mercury_get_transaction_attachment` is the
 * one place a URL is handed out.
 */
export function stripAttachmentUrls(tx: unknown): unknown {
  if (!isRecord(tx)) return tx;

  const attachments = tx["attachments"];
  if (!Array.isArray(attachments) || attachments.length === 0) return tx;

  return {
    ...tx,
    attachments: attachments.map((a) => {
      if (!isRecord(a)) return a;
      const { url: _url, ...rest } = a;
      return rest;
    }),
  };
}

/**
 * Pull the attachments (URLs included) out of a raw transaction
 * payload, optionally narrowed to one file name.
 *
 * This is the deliberate counterpart to `stripAttachmentUrls`: the one
 * code path that hands a pre-signed URL to a caller, reached only
 * through `mercury_get_transaction_attachment`. Returning just the
 * attachments — rather than the whole transaction — keeps the
 * credential-bearing response as small as the job requires.
 */
export function extractAttachments(data: unknown, fileName?: string): unknown {
  const attachments =
    isRecord(data) && Array.isArray(data["attachments"]) ? data["attachments"] : [];

  const selected =
    fileName === undefined
      ? attachments
      : attachments.filter((a) => isRecord(a) && a["fileName"] === fileName);

  return {
    transactionId: isRecord(data) ? (data["id"] ?? null) : null,
    attachmentCount: selected.length,
    attachments: selected,
  };
}

/**
 * Project a transaction list response.
 *
 * Returns the payload untouched when the response does not carry a
 * `transactions` array — Mercury error envelopes and future response
 * shapes must survive unmangled rather than be silently emptied.
 */
export function compactTransactionList(data: unknown, detail: Detail): unknown {
  if (!isRecord(data)) return data;

  const transactions = data["transactions"];
  if (!Array.isArray(transactions)) return data;

  const project = detail === "full" ? stripAttachmentUrls : compactTransaction;
  return { ...data, transactions: transactions.map((tx) => project(tx)) };
}
