# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-17

### Added
- Initial project structure (TypeScript + tsup + jest)
- Mercury API client wrapper (fetch-based, Bearer auth)
- **45 tools** covering virtually the entire Mercury API surface:
  - Banking accounts (5): list, get, cards, organization, categories
  - Banking transactions (5): list, get, update, send_money, list_send_money_requests, request_send_money
  - Recipients (3): list, add, update
  - Statements (1)
  - Treasury (3): get, list_transactions, list_statements
  - Invoicing AR (7): list, get, create, update, send, cancel, list_attachments
  - Customers AR (5): list, get, create, update, delete
  - Webhooks (5): list, get, create, update, delete
  - Chart of Accounts (5): list, get, create, update, delete
  - Journal Entries (5): list, get, create, update, delete
- Auto-detection of sandbox tokens (`mercury_sandbox_*` → api-sandbox URL)
- CI matrix on Node 18/20/22 with Codecov upload
- OpenSSF Scorecard, CodeQL, Dependabot, Secret scanning
- SECURITY.md, issue/PR templates, CODEOWNERS
- npm publish workflow with provenance attestation
- Smithery + Official MCP Registry manifests
- Examples and publishing checklist
