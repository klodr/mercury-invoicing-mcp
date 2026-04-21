# mercury-invoicing-mcp

> Mercury Banking MCP server with full **Invoicing API** support — first MCP to expose Mercury's accounts receivable endpoints.

[![CI](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/codeql.yml)
[![Tested with Vitest](https://img.shields.io/badge/tested%20with-vitest-yellow?logo=vitest&labelColor=black)](https://vitest.dev)
[![codecov](https://codecov.io/gh/klodr/mercury-invoicing-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/klodr/mercury-invoicing-mcp)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/klodr/mercury-invoicing-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/klodr/mercury-invoicing-mcp)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12575/badge)](https://www.bestpractices.dev/projects/12575)
[![Socket Security](https://socket.dev/api/badge/npm/package/mercury-invoicing-mcp)](https://socket.dev/npm/package/mercury-invoicing-mcp)
[![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/klodr/mercury-invoicing-mcp?utm_source=oss&utm_medium=github&utm_campaign=klodr%2Fmercury-invoicing-mcp&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)](https://coderabbit.ai)

[![npm version](https://img.shields.io/npm/v/mercury-invoicing-mcp.svg)](https://www.npmjs.com/package/mercury-invoicing-mcp)
[![npm downloads](https://img.shields.io/npm/dm/mercury-invoicing-mcp.svg)](https://www.npmjs.com/package/mercury-invoicing-mcp)
[![Node.js Version](https://img.shields.io/node/v/mercury-invoicing-mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-1.29-blue)](https://modelcontextprotocol.io)
[![MCP Server](https://badge.mcpx.dev?type=server 'MCP Server')](https://modelcontextprotocol.io)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/klodr/mercury-invoicing-mcp/pulls)

[![Sponsor on GitHub](https://img.shields.io/github/sponsors/klodr?logo=github-sponsors&label=GitHub%20Sponsors&color=EA4AAA)](https://github.com/sponsors/klodr)
[![Patreon](https://img.shields.io/badge/Patreon-F96854?logo=patreon&logoColor=white)](https://www.patreon.com/klodr)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/klodr)

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

### Important: outbound payments depend on YOUR Mercury approval policy

Whether an outbound payment created via this MCP executes immediately or waits for human approval is **not controlled by the MCP** — it is enforced by your Mercury workspace's approval policy (Settings → Approvals on app.mercury.com). The MCP can only ever *create* the API call; what Mercury does with it is up to your workspace configuration.

The three money tools behave differently:

- **`mercury_request_send_money`** — always creates a **pending approval request** in Mercury, regardless of workspace policy. Designed for the "submit, then wait for an approver" workflow.
- **`mercury_send_money`** — submits a payment. It executes immediately *or* gets queued for approval, **depending on your workspace's approval rules** (amount thresholds, account-specific rules, required approvers). On a workspace configured with a $0 approval threshold, every outbound payment waits for human sign-off in the Mercury web/mobile app. On a more permissive workspace, smaller payments may settle without re-prompting.
- **`mercury_create_internal_transfer`** — moves money between two accounts **you already own** inside the same Mercury organisation. No external recipient, no approval workflow.

→ **Set a strict approval policy in Mercury** (e.g. require approval for any outbound payment, regardless of amount) if you intend to expose write tools to an agent. The MCP's per-call rate limits and dry-run mode are useful belt-and-braces, but the authoritative gate is Mercury's approval policy. If a prompt-injected agent calls `send_money`, the safety of that call depends entirely on what Mercury would have done if the same payload arrived from any other API caller.

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

#### 1. Rate limiting (dual-window)

Each write tool is mapped to a **bucket**. Every bucket enforces **two rolling windows simultaneously** — a daily cap (24 h) and a monthly cap (30-day rolling). A call is rejected as soon as either window is at its cap, so a runaway agent cannot drain accounts even if it stays under the daily limit by pacing itself over weeks.

| Bucket | Tools | Daily | Monthly (30d) |
|---|---|---|---|
| `payments` | send_money, request_send_money | 7 | 150 |
| `internal_transfer` | create_internal_transfer | 2 | 40 |
| `invoices_write` | create_invoice, update_invoice | 10 | 200 |
| `invoices_cancel` | cancel_invoice | 3 | 30 |
| `customers_write` | create_customer, update_customer, delete_customer | 3 | 60 |
| `recipients_add` | add_recipient | 3 | 45 |
| `recipients_update` | update_recipient | 2 | 15 |
| `transactions_update` | update_transaction (bookkeeping, tagging, receipts) | 50 | 500 |
| `webhooks_create` | create_webhook | 2 | 15 |
| `webhooks_update` | update_webhook | 2 | 15 |
| `webhooks_delete` | delete_webhook | 2 | 15 |

Override per bucket (both windows must be supplied):

```bash
MERCURY_MCP_RATE_LIMIT_payments=15/day,300/month   # larger supplier batch
MERCURY_MCP_RATE_LIMIT_invoices_write=20/day,400/month  # large monthly billing run
MERCURY_MCP_RATE_LIMIT_DISABLE=true                # disable all rate limiting (not recommended)
```

When exceeded, the tool returns an `isError: true` response with a structured JSON payload. The `source` and `error_type` prefix make it unambiguous that this is a **local MCP safeguard** — the call was never sent to Mercury. A genuine Mercury 429 surfaces separately as `"Mercury API error 429: ..."`.

```json
{
  "source": "mcp_safeguard",
  "error_type": "mcp_rate_limit_daily_exceeded",
  "message": "MCP Rate Limit Exceeded — Daily (local safeguard, not a Mercury API error)",
  "hint": "Daily Limit Exceeded: mercury_send_money (bucket: payments) capped at 7 per 24h. Retry in ~180 min. Override with MERCURY_MCP_RATE_LIMIT_payments=D/day,M/month if this is a legitimate batch.",
  "retry_after": "2026-04-22T00:00:00.000Z"
}
```

`error_type` is either `mcp_rate_limit_daily_exceeded` or `mcp_rate_limit_monthly_exceeded` — the agent learns to back off at the right granularity without confusing the MCP's local cap with a server-side Mercury limit.

The rate-limit window **survives process restarts**. State is persisted to `~/.mercury-mcp/ratelimit.json` (mode `0o600`); override the location with `MERCURY_MCP_STATE_DIR=/abs/path` if you need to share state between hosts or pin it to a specific volume. Without persistence, an MCP host that respawns the server per session would silently bypass the limit.

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

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the test/build/coverage checklist and release process.
