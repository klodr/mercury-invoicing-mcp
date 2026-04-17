# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-17

### Added
- Initial project structure (TypeScript + tsup + jest)
- Mercury API client wrapper (fetch-based, Bearer auth)
- **22 tools** covering the full Mercury API:
  - Banking read: `list_accounts`, `get_account`, `list_transactions`, `get_transaction`, `list_recipients`, `list_statements`, `get_treasury`
  - Banking write: `send_money`, `request_send_money`, `add_recipient`
  - AR Invoicing read: `list_invoices`, `get_invoice`, `list_customers`, `get_customer`, `list_invoice_attachments`
  - AR Invoicing write: `create_invoice`, `update_invoice`, `send_invoice`, `cancel_invoice`, `create_customer`, `update_customer`, `delete_customer`
- CI matrix on Node 18/20/22 with Codecov upload
- OpenSSF Scorecard, CodeQL, Dependabot, Secret scanning
- SECURITY.md, issue/PR templates, CODEOWNERS
- npm publish workflow with provenance attestation
- Smithery + Official MCP Registry manifests
- Examples and publishing checklist
