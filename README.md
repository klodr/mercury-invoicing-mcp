# mercury-invoicing-mcp

> Mercury Banking MCP server with full **Invoicing API** support — first MCP to expose Mercury's accounts receivable endpoints.

[![CI](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/klodr/mercury-invoicing-mcp/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/klodr/mercury-invoicing-mcp/security/code-scanning)
[![codecov](https://codecov.io/gh/klodr/mercury-invoicing-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/klodr/mercury-invoicing-mcp)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/klodr/mercury-invoicing-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/klodr/mercury-invoicing-mcp)

[![npm version](https://img.shields.io/npm/v/mercury-invoicing-mcp.svg)](https://www.npmjs.com/package/mercury-invoicing-mcp)
[![npm downloads](https://img.shields.io/npm/dm/mercury-invoicing-mcp.svg)](https://www.npmjs.com/package/mercury-invoicing-mcp)
[![Node.js Version](https://img.shields.io/node/v/mercury-invoicing-mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-1.25-blue)](https://modelcontextprotocol.io)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/klodr/mercury-invoicing-mcp/pulls)

A Model Context Protocol (MCP) server giving AI assistants (Claude, Cursor, Continue, etc.) full programmatic access to your **Mercury** business banking account, including the **Invoicing API** (one-shot + recurring) which is missing from every other Mercury MCP.

## Why this MCP?

| | Official Mercury MCP | dragonkhoi/mercury-mcp | **mercury-invoicing-mcp** |
|---|:---:|:---:|:---:|
| Banking read (accounts, transactions, statements) | ✅ | ✅ | ✅ |
| Banking write (send money, recipients) | ❌ | ✅ | ✅ |
| **Invoicing API (create, send, list invoices)** | ❌ | ❌ | ✅ |
| **Customers AR (create, manage)** | ❌ | ❌ | ✅ |
| **Recurring invoices** | ❌ | ❌ | ✅ |
| Hosted (no token to manage) | ✅ | ❌ | ❌ |
| Open source (MIT) | ❌ | ✅ | ✅ |

For pure read-only consultation, prefer the [official Mercury MCP](https://docs.mercury.com/docs/what-is-mercury-mcp). Use this one when you need to **automate invoicing**.

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

**Recommended**: use a token with the minimal scope needed. For invoicing-only usage, a token scoped to AR write is sufficient.

### Sandbox mode

To test against Mercury's [sandbox environment](https://docs.mercury.com/reference/using-the-mercury-sandbox-for-api-testing) (no real money, pre-populated dummy data), set:

```bash
MERCURY_API_BASE_URL=https://api-sandbox.mercury.com/api/v1
MERCURY_API_KEY=<your sandbox token>
```

Get a sandbox token from the sandbox dashboard after signing up. Useful for development and CI.

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

Restart the gateway (`docker restart openclaw-openclaw-gateway-1` or your equivalent). The 22 tools become available to all your OpenClaw agents.

> **Tip**: Use a Mercury **read-only** token if you want to expose the MCP to chat-channel agents (WhatsApp, Telegram, Slack). Mercury rejects any write operation regardless of which tool the LLM tries to call — defense in depth against prompt injection.

## Tools

### Banking (read)
- `mercury_list_accounts`
- `mercury_get_account`
- `mercury_list_transactions`
- `mercury_get_transaction`
- `mercury_list_recipients`
- `mercury_get_treasury`
- `mercury_list_statements`

### Banking (write)
- `mercury_send_money`
- `mercury_request_send_money`
- `mercury_add_recipient`

### Invoicing (read)
- `mercury_list_invoices`
- `mercury_get_invoice`
- `mercury_list_customers`
- `mercury_get_customer`

### Invoicing (write)
- `mercury_create_invoice`
- `mercury_update_invoice`
- `mercury_send_invoice`
- `mercury_cancel_invoice`
- `mercury_create_customer`
- `mercury_update_customer`
- `mercury_attach_invoice_pdf`

> Tools available depend on your Mercury API token scope. The server registers all tools but Mercury will reject unauthorized operations at the API level.

## Security

- **Never share your API key.** Use environment variables, never CLI args.
- Use **read-only or scoped tokens** when you don't need write access.
- Be aware of **prompt injection** risks when exposing write tools to LLMs that read untrusted content. See [Anthropic's MCP security guidance](https://docs.anthropic.com/en/docs/agents-and-tools/mcp).

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
