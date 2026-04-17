# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Breaking** — env var renamed: `MERCURY_MCP_RATE_LIMIT_disabled` → `MERCURY_MCP_RATE_LIMIT_DISABLE` (consistent uppercase).
- Audit log: sensitive args (`accountNumber`, `routingNumber`, `apiKey`, `authorization`, `password`, `token`, `secret`, `ssn`) now redacted to `[REDACTED]`. Path must be absolute. File created with mode `0o600`. Write is now synchronous.
- Dry-run `wouldCallWith` payload now also redacts sensitive fields.
- `MercuryError.toString()` and `toJSON()` no longer include the raw response body (kept on the `body` property for callers who need it).

### Removed
- Internal references to non-existent Mercury tools (`update_recipient`, `update_webhook`, COA Templates ×3, Journal Entries ×3) cleaned from `TOOL_CATEGORIES` and `DEFAULT_LIMITS_PER_DAY`.
- Unused `MercuryClient.put()` helper.

### Fixed
- Node 18 compatibility: `randomUUID` imported from `node:crypto` (the global `crypto.randomUUID()` requires Node 19+).

## [0.1.0] - 2026-04-17

### Added
- Initial project structure (TypeScript + tsup + jest)
- Mercury API client wrapper (fetch-based, Bearer auth)
- **32 tools** across the Mercury API surface:
  - Banking accounts (2): `list_accounts`, `get_account`
  - Cards (1): `list_cards`
  - Categories (1): `list_categories`
  - Organization (1): `get_organization`
  - Banking transactions (5): `list_transactions`, `get_transaction`, `update_transaction`, `send_money`, `request_send_money`
  - Recipients (2): `list_recipients`, `add_recipient`
  - Statements (1): `list_statements`
  - Treasury (3): `get_treasury`, `list_treasury_transactions`, `list_treasury_statements`
  - Invoicing AR (7): `list_invoices`, `get_invoice`, `create_invoice`, `update_invoice`, `send_invoice`, `cancel_invoice`, `list_invoice_attachments`
  - Customers AR (5): `list_customers`, `get_customer`, `create_customer`, `update_customer`, `delete_customer`
  - Webhooks (4): `list_webhooks`, `get_webhook`, `create_webhook`, `delete_webhook`
- Auto-detection of sandbox tokens (`mercury_sandbox_*` → api-sandbox URL)
- Middleware: per-category rate limiting (sliding window), dry-run mode, opt-in audit log
- CI matrix on Node 18/20/22 with Codecov upload
- OpenSSF Scorecard, CodeQL, Dependabot, Secret scanning
- SECURITY.md, issue/PR templates, CODEOWNERS
- npm publish workflow with provenance attestation
- Smithery + Official MCP Registry manifests
- Examples and publishing checklist
