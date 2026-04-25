# Roadmap

Loose planning horizon of ~12 months. The MCP follows Mercury's own API surface — we don't plan features Mercury doesn't expose.

## Near-term

- **Transaction attachments** — wrap `uploadtransactionattachment`, `getattachment`, and the listing endpoints so an agent can attach receipts / invoices / supporting documents to a transaction and retrieve them back. Priority driver: bookkeeping workflows where justificatifs need to be pinned to transactions programmatically.
- **Finer-grained per-tool gating** — today the rate-limit policy lives in `TOOL_BUCKET` with broad families (payments / customers_write / etc.). Move towards per-tool caps driven by real usage demand once we have feedback from multi-user workspaces.
- **Scope-aware tool list filtering** — inspect the Mercury token at startup and hide tools the token cannot invoke, instead of relying on Mercury's 403 response at call time (mirrors the OAuth-scope filtering already done in `@klodr/gmail-mcp`).
- ~~**Mercury IO Credit account exposure**~~ — shipped: `mercury_list_credit_accounts` wraps `GET /credit` (documented under [Credit › List all credit accounts](https://docs.mercury.com/reference/credit)) and `mercury_list_credit_transactions` wraps the singular `GET /account/{id}/transactions` path used for IO Credit transactions.
- **Invoice automatic reminders flag** — `mercury_create_invoice` and `mercury_update_invoice` do not expose the per-invoice "Send automatic reminders" toggle that the Mercury Dashboard offers; `GET /invoice/{id}` does not return the field either. Open question with Mercury: whether the API exposes a per-invoice flag (likely `sendAutomaticReminders: boolean`) or whether automatic reminders remain a workspace-level setting only configurable via the Dashboard UI. Once clarified, either plumb the flag through create + update schemas and surface it on get, or document explicitly that this is Dashboard-only.

## Tracking Mercury's API

- **New endpoints as Mercury ships them** — if Mercury widens the public API (PDF download, send-money approvals, user/credit endpoints, Raise SAFE, OAuth flow — see the [`Endpoints not yet wrapped`](../README.md#tools-36-total) section of the README for the full list), wrap them on a demand-driven basis.
- **Webhooks signature verification** — add `verifywebhook` helper + a worked example once Mercury formalises the signing algorithm in docs.

## Discoverability

- **MCP registries** — publish to the public MCP indexes: [official MCP Registry](https://github.com/modelcontextprotocol/registry), [mcp.so](https://mcp.so), [glama.ai](https://glama.ai/mcp), [smithery.ai](https://smithery.ai).

## Compliance / governance

- **Second maintainer → OpenSSF Gold** — actively welcome co-maintainership via `.github/CODEOWNERS` once a contributor has several merged PRs. Gold requires ≥2 active maintainers; that's the gating constraint.

