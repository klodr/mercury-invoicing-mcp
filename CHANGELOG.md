# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-04-18

### Added

- `release.yml`: Sigstore (keyless OIDC) signing of `dist/index.js`. The signed artifact + `.sigstore` bundle are uploaded to the GitHub Release before npm publish. Satisfies Scorecard's `Signed-Releases` check (npm provenance alone is not enough — Scorecard inspects GitHub Release assets).
- `release.yml`: split into two jobs (`build` read-only, `publish` write + release-only) for least-privilege token scopes.

### Removed

- README: Snyk vulnerability badge. Snyk deprecated the `/test/github/{owner}/{repo}/badge.svg` endpoint (HTTP 410 Gone). The Snyk GitHub App still runs on every PR (visible as `security/snyk` status check), so the protection itself is unchanged — only the README badge had to go.

### Changed
- `lineItemSchema.name` now enforces `.min(1).max(200)` at the Zod level. Mercury silently accepts longer names on `POST /ar/invoices` (create) but rejects them on the edit endpoint with `"Item name: Must be 200 characters or fewer"`, leaving the invoice in an unmodifiable state. The MCP now refuses upfront with a clean validation error.
- `invoiceNumber` now enforces `.max(255)`. Mercury accepts up to ~280 characters and rejects 300+, so 255 is a safe ceiling that also matches typical varchar(255) database conventions.

### Tested but not enforced (no schema-level limit needed)
- `payerMemo`, `internalNote`, `customer.name` all accept ≥5000 characters in production. No artificial limit added.

## [0.2.0] - 2026-04-17

### Added
- **`mercury_create_internal_transfer`** — move money between two of your own Mercury accounts (e.g. Checking → Savings). `POST /transfer`, with auto-generated `idempotencyKey`.
- **`mercury_update_recipient`** — fix a recipient's nickname / contact email / payment method without recreating it. `POST /recipient/{id}` (singular).
- **`mercury_update_webhook`** — change a webhook's URL, status (active/paused) or event types. Useful to reactivate a webhook that was disabled after consecutive delivery failures. `POST /webhooks/{id}`.
- `defineTool` and `textResult` helpers in `src/tools/_shared.ts` (eliminates the per-handler `JSON.stringify` boilerplate across all 34 tools).
- `scripts/sync-version.mjs` — single-source the package version: `package.json` is authoritative, the script propagates it into `server.json` and `src/server.ts`. Wired to the `npm version` lifecycle hook.

### Changed
- **Breaking** — `mercury_update_transaction` no longer takes `accountId`. Mercury's real endpoint is `PATCH /transaction/{id}` (no account in the path). Fields are now `note` (nullable) and `categoryId` (nullable); `externalMemo` was never accepted by the endpoint and has been removed.
- **Breaking** — env var renamed: `MERCURY_MCP_RATE_LIMIT_disabled` → `MERCURY_MCP_RATE_LIMIT_DISABLE` (consistent uppercase).
- **Breaking** — `lineItemSchema` now requires `name` (was `description`). Mercury rejects line items without `name`. `description` becomes an optional longer-form field.
- `mercury_update_invoice` now uses the correct Mercury endpoint: `POST /ar/invoices/{id}` (not PATCH). The handler fetches the current invoice, merges the supplied changes, and submits the full payload that Mercury expects — callers can still pass only the fields they want to change.
- Audit log: sensitive args (`accountNumber`, `routingNumber`, `apiKey`, `authorization`, `password`, `token`, `secret`, `ssn`) now redacted to `[REDACTED]`. Path must be absolute. File created with mode `0o600`. Write is now synchronous.
- Dry-run `wouldCallWith` payload now also redacts sensitive fields.
- `MercuryError.toString()` and `toJSON()` no longer include the raw response body (kept on the `body` property for callers who need it).
- Tool registration goes through a `defineTool` helper that calls the SDK's non-deprecated `server.registerTool` (the previous monkey-patch on `server.tool` is gone).
- `wrapToolHandler` now catches `MercuryError` and returns a clean `isError:true` response, with a hint for HTTP 403 on AR endpoints (Mercury Plus plan required).
- All path-injected IDs (`accountId`, `transactionId`, `recipientId`, `webhookId`) now require `.uuid()` validation, and `MercuryClient.request` URL-encodes each path segment (defense-in-depth against prompt injection).
- Sandbox auto-detection now uses a strict prefix match (`apiKey.startsWith("secret-token:mercury_sandbox_")`) instead of a substring check.
- `fetch` requests now have a 30s `AbortSignal.timeout` so a hung Mercury endpoint cannot block the MCP indefinitely.

### Removed
- **`mercury_send_invoice`** — Mercury does NOT expose `POST /ar/invoices/{id}/send` (404 confirmed in production). Email delivery is only triggered by `sendEmailOption: "SendNow"` at invoice creation time. Documented in `mercury_create_invoice`.
- Internal references to non-existent Mercury tools (COA Templates ×3, Journal Entries ×3) cleaned from `TOOL_CATEGORIES` and `DEFAULT_LIMITS_PER_DAY`.
- Unused `MercuryClient.put()` helper.

### Fixed
- Node 18 compatibility: `randomUUID` imported from `node:crypto` (the global `crypto.randomUUID()` requires Node 19+).

### Security
- All GitHub Actions in `.github/workflows/` are now pinned by full commit SHA (was tag-based, vulnerable to tag rewriting). `release.yml` is the highest-risk workflow — it carries `NPM_TOKEN`.
- Sourcemaps are emitted only when `NODE_ENV !== "production"`. The published npm tarball no longer ships `dist/index.js.map` (which would otherwise expose the full TypeScript source). `prepublishOnly` sets `NODE_ENV=production`.

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
