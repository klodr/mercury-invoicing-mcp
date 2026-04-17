# Examples

- [`claude-desktop-config.json`](./claude-desktop-config.json) — minimal config for Claude Desktop
- [`cursor-mcp.json`](./cursor-mcp.json) — minimal config for Cursor
- [`recurring-invoicing.md`](./recurring-invoicing.md) — walkthrough: setting up recurring monthly invoicing for a client

## Snippets

### Read-only audit token

If you only want the assistant to read your account state (no transfers, no invoice creation), use a Mercury **read-only** API token. The MCP still registers all tools but Mercury rejects unauthorized operations at the API level.

### Restricting tools to a subset (advanced)

The MCP currently registers all 22 tools. If you want to restrict the surface (e.g. for an agent reading untrusted content), you can either:

1. Use a read-only Mercury token (recommended)
2. Fork this repo and remove the write tools from `src/tools/index.ts`
