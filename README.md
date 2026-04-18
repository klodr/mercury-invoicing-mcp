# mercury-invoicing-mcp

> Mercury Banking MCP server with full **Invoicing API** support — first MCP to expose Mercury's accounts receivable endpoints.

[![CI](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/klodr/mercury-invoicing-mcp/security/code-scanning)
[![codecov](https://codecov.io/gh/klodr/mercury-invoicing-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/klodr/mercury-invoicing-mcp)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/klodr/mercury-invoicing-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/klodr/mercury-invoicing-mcp)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12575/badge)](https://www.bestpractices.dev/projects/12575)
[![Socket Security](https://socket.dev/api/badge/npm/package/mercury-invoicing-mcp)](https://socket.dev/npm/package/mercury-invoicing-mcp)

[![npm version](https://img.shields.io/npm/v/mercury-invoicing-mcp.svg)](https://www.npmjs.com/package/mercury-invoicing-mcp)
[![npm downloads](https://img.shields.io/npm/dm/mercury-invoicing-mcp.svg)](https://www.npmjs.com/package/mercury-invoicing-mcp)
[![Node.js Version](https://img.shields.io/node/v/mercury-invoicing-mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-1.25-blue)](https://modelcontextprotocol.io)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/klodr/mercury-invoicing-mcp/pulls)

A Model Context Protocol (MCP) server giving AI assistants (Claude, Cursor, Continue, etc.) full programmatic access to your **Mercury** business banking account, including the **Invoicing API** (one-shot + recurring) which is missing from every other Mercury MCP.

## Why this MCP?

| Capability | Official Mercury MCP | dragonkhoi/mercury-mcp | **mercury-invoicing-mcp** |
|---|:---:|:---:|:---:|
| Banking read (accounts, transactions, statements) | ✅ | ✅ | ✅ |
| Banking write (send_money, recipients) | ❌ | ✅ | ✅ |
| **Internal transfers between your own Mercury accounts** | ❌ | ❌ | ✅ |
| **Invoicing API (create, update, cancel, attachments)** | ❌ | ❌ | ✅ |
| **Customers AR + recurring invoices** | ❌ | ❌ | ✅ |
| Webhooks full CRUD (incl. `update_webhook`) | ❌ | ❌ | ✅ |
| Built-in safeguards (rate limit, dry-run, redacted audit log) | ❌ | ❌ | ✅ |
| Hosted (no token to manage) | ✅ | ❌ | ❌ |
| Open source (MIT) | ❌ | ✅ | ✅ |
| Total tools exposed | ~10 | ~11 | **34** |

For pure read-only consultation, prefer the [official Mercury MCP](https://docs.mercury.com/docs/what-is-mercury-mcp). Use this one when you need to **automate invoicing, write to Mercury, or expose Mercury to LLM agents safely**.

## Installation

```bash
npm install -g mercury-invoicing-mcp
```

Or use directly with `npx`:

```bash
npx mercury-invoicing-mcp
```

## Configuration

The server reads `MERCURY_API_KEY` from the environment. Get your API key at [Mercury Settings → API Tokens](https://app.mercury.com/settings/tokens).

### Right-sizing the token

Mercury exposes **fine-grained per-resource scopes** at token creation — not a single read/write toggle. Pick exactly what your use case needs and Mercury enforces the rest server-side: a tool called without the right scope returns `403`, which the MCP surfaces as a clean `isError: true` response (with a Mercury Plus hint when relevant).

When you create the token, you choose:

- **Which accounts** the token can see (one, several, or all).
- **Read or Write per resource family**: Accounts, Transactions, Recipients, Send Money, Cards, Statements, Treasury, Invoicing (AR), Webhooks.

Common scope recipes for this MCP:

| Use case | Scopes to grant |
|---|---|
| Read-only consultation (dashboards, chat-channel bots) | Read on `accounts`, `transactions`, `statements`, `cards`, `treasury` — nothing else |
| Bookkeeping (categorise transactions) | Read everywhere + Write on `transactions` (for `update_transaction`) |
| Invoicing automation | Read on `accounts` + Write on `invoices`, `customers` (Mercury Plus required) |
| Recipients management | + Write on `recipients` |
| Internal transfers between your own accounts | + Write on `send_money` (used for `create_internal_transfer`) |
| Outbound send-money requests | + Write on `send_money` (creates the request — see safety note below) |
| Webhooks-only ops | Write on `webhooks` only |

### Important: Mercury never auto-executes outbound payments

Every **external** money movement created by this MCP — `send_money`, `request_send_money` — is queued as a **pending request inside Mercury** and **must be approved by a human in the Mercury web app or mobile app** before any funds leave the account. The token scope authorises the MCP to *create* the request; it cannot bypass Mercury's approval workflow.

The only money operations that complete without explicit human re-approval are **internal transfers between accounts you own** (`create_internal_transfer`) — funds stay inside your Mercury organisation.

So even if a prompt-injected agent calls `send_money` with attacker-chosen recipient and amount, you (or whoever holds approval rights in your Mercury workspace) still see the pending request in the Mercury UI and can reject it before money moves. This is a **structural safety boundary on Mercury's side**, not just a feature of the MCP.

### Sandbox mode

To test against Mercury's [sandbox environment](https://docs.mercury.com/docs/using-mercury-sandbox) (no real money, pre-populated dummy data), just use a sandbox token:

```bash
MERCURY_API_KEY=secret-token:mercury_sandbox_xxxxxxxxxxxxxxxx
```

The MCP **auto-detects sandbox tokens** (those starting with `mercury_sandbox_`) and points to `https://api-sandbox.mercury.com/api/v1` automatically.

To override the base URL explicitly (e.g. for a self-hosted proxy):

```bash
MERCURY_API_BASE_URL=https://your-proxy.example.com/api/v1
```

### Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (or `~/.claude.json` for Claude Code):

```json
{
  "mcpServers": {
    "mercury-invoicing": {
      "command": "npx",
      "args": ["-y", "mercury-invoicing-mcp"],
      "env": {
        "MERCURY_API_KEY": "secret-token:mercury_production_xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mercury-invoicing": {
      "command": "npx",
      "args": ["-y", "mercury-invoicing-mcp"],
      "env": {
        "MERCURY_API_KEY": "secret-token:..."
      }
    }
  }
}
```

### OpenClaw

[OpenClaw](https://docs.openclaw.ai) is an open-source self-hosted agent platform that supports MCP via `@modelcontextprotocol/sdk`. Add to `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "mercury-invoicing": {
      "command": "npx",
      "args": ["-y", "mercury-invoicing-mcp"],
      "env": {
        "MERCURY_API_KEY": "secret-token:..."
      }
    }
  }
}
```

Restart the gateway (`docker restart openclaw-openclaw-gateway-1` or your equivalent). All tools become available to all your OpenClaw agents.

> **Tip**: For agents exposed to untrusted channels (WhatsApp, Telegram, Slack, incoming email…), grant the token only the scopes the channel actually needs. Outbound payments still require explicit human approval in the Mercury app — but minimising scopes avoids noise (spurious pending requests) and reduces what an attacker could exfiltrate via reads. See [Right-sizing the token](#right-sizing-the-token) for recipe per use case.

## Tools (34 total)

### Banking — Accounts
- `mercury_list_accounts`, `mercury_get_account`
- `mercury_list_cards`
- `mercury_get_organization`
- `mercury_list_categories`

### Banking — Transactions
- `mercury_list_transactions`, `mercury_get_transaction`
- `mercury_update_transaction` (note, category)
- `mercury_send_money`, `mercury_request_send_money`
- `mercury_create_internal_transfer` (between your own Mercury accounts)

### Banking — Recipients
- `mercury_list_recipients`, `mercury_add_recipient`, `mercury_update_recipient`

### Banking — Statements
- `mercury_list_statements`

### Treasury
- `mercury_get_treasury`
- `mercury_list_treasury_transactions`
- `mercury_list_treasury_statements`

### Invoicing (Accounts Receivable)

> ⚠️ **Mercury Plus plan required.** The Invoicing & Customers (AR) APIs are only available on Mercury's [Plus plan](https://mercury.com/pricing) (or higher). Calls to these tools return `403 Forbidden` on Free or Standard plans. The other tools (banking, treasury, webhooks) work on every plan.

- `mercury_list_invoices`, `mercury_get_invoice`
- `mercury_create_invoice`, `mercury_update_invoice`
- `mercury_cancel_invoice`
- `mercury_list_invoice_attachments`

### Customers (AR) — also requires Mercury Plus
- `mercury_list_customers`, `mercury_get_customer`
- `mercury_create_customer`, `mercury_update_customer`, `mercury_delete_customer`

### Webhooks
- `mercury_list_webhooks`, `mercury_get_webhook`
- `mercury_create_webhook`, `mercury_update_webhook`, `mercury_delete_webhook`

> **Endpoints not yet wrapped** — Mercury exposes ~25 additional endpoints
> that this MCP does not yet cover. They will land in upcoming releases.
> Tracked: PDF download (`getinvoicepdf`, `getstatementpdf`), attachments
> (`uploadtransactionattachment`, `uploadrecipientattachment`,
> `getattachment`, `listrecipientsattachments`), webhook signature
> verification (`verifywebhook`), webhook events (`getevent`, `getevents`),
> send-money approvals (`listsendmoneyapprovalrequests`,
> `getsendmoneyapprovalrequest`), credit lines (`listcredit`),
> users (`getuser`, `getusers`), Mercury Raise SAFE
> (`getsaferequest(s)`, `getsaferequestdocument`), and OAuth flow
> (`obtainaccesstoken`, `startoauth2flow`).

> Mercury does **not** expose `list_send_money_requests`, COA Templates
> or Journal Entries via the public API at all — those features are
> dashboard-only.

> There is **no `send_invoice` endpoint** anywhere (API or dashboard).
> An invoice email is only sent when the invoice is created with
> `sendEmailOption: "SendNow"`. To send a copy later, download the
> invoice PDF (Mercury UI button "Download PDF", or the
> `getinvoicepdf` endpoint — not yet wrapped, see "Endpoints not yet
> wrapped" above) and email it manually.

> Tools available depend on your Mercury API token scope. The server
> registers all 34 tools but Mercury will reject unauthorized operations
> at the API level.

## Security

- **Never share your API key.** Use environment variables, never CLI args.
- Use **read-only or scoped tokens** when you don't need write access.
- Be aware of **prompt injection** risks when exposing write tools to LLMs that read untrusted content. See [Anthropic's MCP security guidance](https://docs.anthropic.com/en/docs/agents-and-tools/mcp).

### Built-in safeguards

This MCP includes three middleware layers that activate automatically on write tools (read tools are unaffected):

#### 1. Rate limiting

Per-category daily limits prevent runaway agents from draining accounts or spamming the API.

| Category | Tools | Default |
|---|---|---|
| `money` | send_money, request_send_money | 50/day |
| `internal_transfer` | create_internal_transfer (between your own Mercury accounts) | 5/day |
| `invoicing` | create/update/cancel invoice + create/update/delete customer | 100/day |
| `banking` | add_recipient, update_recipient, update_transaction | 200/day |
| `webhooks` | create/update/delete webhook | 5/day |

Override per category (units: `/hour`, `/day`, `/week`):

```bash
MERCURY_MCP_RATE_LIMIT_money=200/day      # bigger supplier batch
MERCURY_MCP_RATE_LIMIT_invoicing=1000/day # large monthly billing run
MERCURY_MCP_RATE_LIMIT_DISABLE=true       # disable all rate limiting (not recommended)
```

When exceeded, the tool returns an `isError: true` response with a clear message and retry hint — the agent learns to back off naturally.

#### 2. Dry-run mode

Inspect what an agent *would* do without actually calling Mercury. Useful for debugging suspected behaviour or staging:

```bash
MERCURY_MCP_DRY_RUN=true
```

Write tools then return a structured payload describing the intended action without hitting the Mercury API.

#### 3. Audit log (opt-in)

Enable structured JSON logging of every write call:

```bash
MERCURY_MCP_AUDIT_LOG=/var/log/mercury-mcp-audit.log
```

Each line is `{ts, tool, result, args}` (one JSON object per line). Result is `ok`, `dry-run`, or `error`. The path must be **absolute**; sensitive fields in `args` (`accountNumber`, `routingNumber`, `apiKey`, `authorization`, `password`, `token`, `secret`, `ssn`) are automatically redacted. The file is created with mode `0600` (owner read/write only).

## Development

```bash
git clone https://github.com/klodr/mercury-invoicing-mcp.git
cd mercury-invoicing-mcp
npm install
npm run build
npm test
```

## Inspiration

- [@stripe/mcp](https://github.com/stripe/ai/tree/main/tools/modelcontextprotocol) — architecture patterns
- [dragonkhoi/mercury-mcp](https://github.com/dragonkhoi/mercury-mcp) — initial banking tool implementations
- [Official Mercury MCP](https://docs.mercury.com/docs/what-is-mercury-mcp) — read-only reference

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

Issues and PRs welcome. Please open an issue first for substantial changes.

Before submitting a PR:

1. `npm install` then `npm test` (must stay at 82/82 with ≥98% statement coverage)
2. `npm run build` (must succeed; the published tarball is only `dist/index.js` + `package.json` + `README.md` + `LICENSE`)
3. Update `CHANGELOG.md` under `[Unreleased]`
4. If you add or rename a tool, update the `Tools` section in this README and the `defineTool(server, ...)` call in `src/tools/`
5. New write tools must be registered in `TOOL_CATEGORIES` (`src/middleware.ts`) so they are rate-limited

For releases, do not edit `version` by hand — run `npm version patch|minor|major`; the lifecycle hook calls `scripts/sync-version.mjs` to propagate the bump into `server.json` and `src/server.ts`.
