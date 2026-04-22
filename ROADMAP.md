# Roadmap

Loose planning horizon of ~12 months. The MCP follows Mercury's own API surface — we don't plan features Mercury doesn't expose.

## Near-term

- **Node.js 22 migration — deadline 2026-04-30** — Node 20 reaches security-support EOL on April 30, 2026. Bump `engines.node` to `>=22.0.0`, retarget `tsup.config.ts` to `node22`, pin the Dockerfile to `node:22-alpine@sha256:…`, drop Node 20 from the CI matrix (keep 22/24), bump `@types/node` to `^22.x`. Blocking for any release cut after 2026-04-30.
- **Transaction attachments** — wrap `uploadtransactionattachment`, `getattachment`, and the listing endpoints so an agent can attach receipts / invoices / supporting documents to a transaction and retrieve them back. Priority driver: bookkeeping workflows where justificatifs need to be pinned to transactions programmatically.
- **Finer-grained per-tool gating** — today the rate-limit policy lives in `TOOL_BUCKET` with broad families (payments / customers_write / etc.). Move towards per-tool caps driven by real usage demand once we have feedback from multi-user workspaces.
- **Scope-aware tool list filtering** — inspect the Mercury token at startup and hide tools the token cannot invoke, instead of relying on Mercury's 403 response at call time (mirrors the OAuth-scope filtering already done in `@klodr/gmail-mcp`).

## Tracking Mercury's API

- **New endpoints as Mercury ships them** — if Mercury widens the public API (PDF download, send-money approvals, user/credit endpoints, Raise SAFE, OAuth flow — see the [`Endpoints not yet wrapped`](./README.md#tools-34-total) section of the README for the full list), wrap them on a demand-driven basis.
- **Webhooks signature verification** — add `verifywebhook` helper + a worked example once Mercury formalises the signing algorithm in docs.

## Discoverability

- **MCP registries** — publish to the public MCP indexes: [official MCP Registry](https://github.com/modelcontextprotocol/registry), [mcp.so](https://mcp.so), [glama.ai](https://glama.ai/mcp), [smithery.ai](https://smithery.ai).

## Compliance / governance

- **Second maintainer → OpenSSF Gold** — actively welcome co-maintainership via `.github/CODEOWNERS` once a contributor has several merged PRs. Gold requires ≥2 active maintainers; that's the gating constraint.

