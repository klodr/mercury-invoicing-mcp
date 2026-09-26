import { describe, it, expect } from "vitest";
import {
  compactTransaction,
  compactTransactionList,
  extractAttachments,
  stripAttachmentUrls,
} from "../src/project.js";

/**
 * Shape mirrors a real Mercury deposit-account transaction, trimmed to
 * the fields these helpers actually branch on. The `url` is a stand-in
 * for the ~2.4 kB pre-signed S3 URL Mercury really returns.
 */
const RAW = {
  id: "e83067bc-e4f5-11f0-b104-2792ef6f7ecc",
  amount: -14.05,
  status: "sent",
  kind: "debitCardTransaction",
  postedAt: "2025-12-30T08:07:03.603495Z",
  createdAt: "2025-12-29T20:35:26.184034Z",
  counterpartyId: "69c15a64-e039-11f0-a5e9-bb2c58fdc9c1",
  counterpartyName: "Fiverr",
  bankDescription: "FIVERR *",
  note: null,
  externalMemo: null,
  mercuryCategory: "ProfessionalServices",
  cardId: "0f169f36-d123-11f0-b939-af1a2b71faf9",
  dashboardLink: "https://mercury.com/transactions/e83067bc",
  trackingNumber: "111000021600304",
  glAllocations: [],
  relatedTransactions: [],
  merchant: { categoryCode: "7399", id: "767219613886" },
  categoryData: { id: "992fc2ef", name: "Legal & Professional Services" },
  attachments: [
    {
      fileName: "FI53381960578.pdf",
      attachmentType: "receipt",
      url: "https://s3.example.invalid/x?X-Amz-Signature=deadbeef",
    },
  ],
};

describe("compactTransaction", () => {
  it("keeps the identifying fields", () => {
    const out = compactTransaction(RAW) as Record<string, unknown>;
    expect(out["id"]).toBe(RAW.id);
    expect(out["amount"]).toBe(-14.05);
    expect(out["counterpartyName"]).toBe("Fiverr");
    expect(out["counterpartyId"]).toBe(RAW.counterpartyId);
    expect(out["bankDescription"]).toBe("FIVERR *");
  });

  it("drops bulky and unlisted fields", () => {
    const out = compactTransaction(RAW) as Record<string, unknown>;
    for (const dropped of [
      "dashboardLink",
      "trackingNumber",
      "glAllocations",
      "relatedTransactions",
      "merchant",
      "categoryData",
      "attachments",
      "createdAt",
    ]) {
      expect(out).not.toHaveProperty(dropped);
    }
  });

  it("omits null-valued fields rather than emitting them", () => {
    const out = compactTransaction(RAW) as Record<string, unknown>;
    expect(out).not.toHaveProperty("note");
    expect(out).not.toHaveProperty("externalMemo");
  });

  it("keeps createdAt when the transaction has not posted", () => {
    // A pending card authorisation carries no `postedAt`; dropping
    // `createdAt` too would leave the row undatable, and `pending` is a
    // supported filter on mercury_list_credit_transactions.
    const { postedAt: _postedAt, ...pending } = RAW;
    const out = compactTransaction({ ...pending, status: "pending" }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("postedAt");
    expect(out["createdAt"]).toBe(RAW.createdAt);
  });

  it("flattens categoryData to categoryName", () => {
    const out = compactTransaction(RAW) as Record<string, unknown>;
    expect(out["categoryName"]).toBe("Legal & Professional Services");
  });

  it("reports hasAttachment true when a receipt is on file", () => {
    const out = compactTransaction(RAW) as Record<string, unknown>;
    expect(out["hasAttachment"]).toBe(true);
  });

  it("emits hasAttachment false rather than omitting it", () => {
    // The question this answers is "which transactions still lack a
    // receipt" — an absent key cannot be filtered on.
    const out = compactTransaction({ ...RAW, attachments: [] }) as Record<string, unknown>;
    expect(out["hasAttachment"]).toBe(false);
    const none = compactTransaction({ id: "x" }) as Record<string, unknown>;
    expect(none["hasAttachment"]).toBe(false);
  });

  it("never leaks a pre-signed URL", () => {
    expect(JSON.stringify(compactTransaction(RAW))).not.toContain("X-Amz-Signature");
  });

  it("passes non-objects through untouched", () => {
    expect(compactTransaction(null)).toBeNull();
    expect(compactTransaction("nope")).toBe("nope");
  });
});

describe("stripAttachmentUrls", () => {
  it("removes the url but keeps the file name and type", () => {
    const out = stripAttachmentUrls(RAW) as { attachments: Record<string, unknown>[] };
    expect(out.attachments[0]).toEqual({
      fileName: "FI53381960578.pdf",
      attachmentType: "receipt",
    });
  });

  it("leaves every other field intact", () => {
    const out = stripAttachmentUrls(RAW) as Record<string, unknown>;
    expect(out["dashboardLink"]).toBe(RAW.dashboardLink);
    expect(out["categoryData"]).toEqual(RAW.categoryData);
  });

  it("returns the input untouched when there are no attachments", () => {
    const bare = { id: "x", attachments: [] };
    expect(stripAttachmentUrls(bare)).toBe(bare);
    expect(stripAttachmentUrls(null)).toBeNull();
  });
});

describe("compactTransactionList", () => {
  it("projects every transaction in compact mode", () => {
    const out = compactTransactionList({ total: 1, transactions: [RAW] }, "compact") as {
      total: number;
      transactions: Record<string, unknown>[];
    };
    expect(out.total).toBe(1);
    expect(out.transactions[0]).not.toHaveProperty("dashboardLink");
    expect(out.transactions[0]["hasAttachment"]).toBe(true);
  });

  it("keeps every field in full mode but still strips URLs", () => {
    const out = compactTransactionList({ transactions: [RAW] }, "full") as {
      transactions: Record<string, unknown>[];
    };
    expect(out.transactions[0]["dashboardLink"]).toBe(RAW.dashboardLink);
    expect(JSON.stringify(out)).not.toContain("X-Amz-Signature");
  });

  it("passes through payloads that carry no transactions array", () => {
    const err = { errors: { message: "not found" } };
    expect(compactTransactionList(err, "compact")).toBe(err);
    expect(compactTransactionList(null, "compact")).toBeNull();
  });
});

describe("extractAttachments", () => {
  it("returns the attachments with their URLs", () => {
    const out = extractAttachments(RAW) as {
      transactionId: string;
      attachmentCount: number;
      attachments: Record<string, unknown>[];
    };
    expect(out.transactionId).toBe(RAW.id);
    expect(out.attachmentCount).toBe(1);
    expect(out.attachments[0]["url"]).toContain("X-Amz-Signature");
  });

  it("narrows to a single file name when asked", () => {
    const two = {
      ...RAW,
      attachments: [...RAW.attachments, { fileName: "other.pdf", url: "https://x.invalid" }],
    };
    const out = extractAttachments(two, "other.pdf") as {
      attachmentCount: number;
      attachments: Record<string, unknown>[];
    };
    expect(out.attachmentCount).toBe(1);
    expect(out.attachments[0]["fileName"]).toBe("other.pdf");
  });

  it("reports an empty set rather than throwing when there is nothing", () => {
    const out = extractAttachments({ id: "x" }) as {
      attachmentCount: number;
      attachments: unknown[];
    };
    expect(out.attachmentCount).toBe(0);
    expect(out.attachments).toEqual([]);
    expect((extractAttachments(null) as { transactionId: unknown }).transactionId).toBeNull();
  });
});
