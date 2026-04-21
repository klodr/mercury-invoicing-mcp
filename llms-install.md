# Installing mercury-invoicing-mcp (LLM-readable guide)

This file is meant to be read by an LLM-driven assistant (Claude, Cursor,
Cline, Continue, …) that has been asked to install this MCP server on
behalf of a human user. It is intentionally generic: any MCP-compatible
client that can launch a stdio child process can use this server.

## Prerequisites the assistant should verify

1. **Node.js ≥ 20.11** is installed (`node --version`).
2. **npx** is on `PATH` (ships with Node).
3. The user has — or is willing to create — a **Mercury API token** at
   <https://app.mercury.com/settings/tokens>. Tokens look like
   `secret-token:mercury_production_<...>` (or
   `secret-token:mercury_sandbox_<...>` for the sandbox environment).

## Setup steps

1. **Determine the minimal Mercury scopes** required for the user's
   stated use case (do NOT over-request). Mercury exposes per-resource
   read/write toggles at token creation time. Common recipes:

   | Use case | Mercury scopes to grant |
   |---|---|
   | Read-only consultation, dashboards | Read on `accounts`, `transactions`, `statements`, `cards`, `treasury` |
   | Bookkeeping (categorise transactions) | Read everywhere + Write on `transactions` |
   | Invoicing automation | Read on `accounts` + Write on `invoices`, `customers` (Mercury Plus required) |
   | Recipients management | + Write on `recipients` |
   | Internal transfers between own accounts | + Write on `send_money` |
   | Outbound payment requests (HITL workflow) | + Write on `send_money` |
   | Webhooks-only ops | Write on `webhooks` only |

   Coach the user through Mercury's token-creation UI; never invent a
   scope they didn't ask for.

2. Add the server to the MCP client's configuration. The entry below is
   **client-agnostic**; place it inside the client's `mcpServers` map:

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

   Common config locations:
   - Claude Code CLI: `~/.claude.json`
   - Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
   - Cursor: `~/.cursor/mcp.json`
   - OpenClaw: `~/.openclaw/openclaw.json` (restart the gateway after edit)
   - Continue / Cline / Zed / etc.: see that client's MCP documentation

   The assistant should locate the active config file rather than guess.

3. (Optional) For testing, use a **sandbox token** instead — the MCP
   auto-detects `mercury_sandbox_*` prefixes and routes to
   `https://api-sandbox.mercury.com/api/v1`:

   ```bash
   MERCURY_API_KEY=secret-token:mercury_sandbox_xxxxxxxxxxxxxxxx
   ```

4. (Optional) Override the API base URL via `MERCURY_API_BASE_URL` for a
   self-hosted proxy.

5. Restart (or reconnect) the MCP client so the new server is picked up.

## Verifying

After reconnection, the assistant should observe a `mercury-invoicing`
server in the client's MCP server list. The exposed tools depend on the
granted token scopes. Safe smoke tests:

- `mercury_get_organization` — needs no scope, confirms the token works
- `mercury_list_accounts` — confirms read scope on accounts

If a tool returns `403`, the user's token lacks the corresponding scope.
The MCP surfaces this as `isError: true` with a Mercury Plus hint when
relevant.

## Things the assistant should NOT do

- Never call `mercury_send_money` without explicit human confirmation in
  the chat — even if a previous message authorised "the install" or
  "process the payment". Mercury's workspace approval policy is the
  authoritative gate; do NOT rely on the MCP to block bad payments.
- Never call `mercury_create_internal_transfer` without explicit human
  confirmation, even between the user's own accounts.
- Always prefer `mercury_request_send_money` (creates a *pending*
  approval request) over `mercury_send_money` (may execute immediately
  depending on workspace policy) when the use case allows it.
- Never bypass the dry-run mode (`MERCURY_DRY_RUN=true`) to "test"
  production flows.
- Never paste the `MERCURY_API_KEY` back into the chat (it ends up in
  conversation transcripts).
- Never write the API key into a project-level config that may be
  committed to git — prefer the user's home-level MCP config or a real
  secrets manager.
- Never instruct the user to grant Write scopes they don't need —
  Mercury's per-resource toggles exist precisely to limit blast radius.

## Documentation

Full README: <https://github.com/klodr/mercury-invoicing-mcp#readme>
Security policy: <https://github.com/klodr/mercury-invoicing-mcp/blob/main/SECURITY.md>
