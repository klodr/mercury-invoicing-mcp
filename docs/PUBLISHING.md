# Publishing & Distribution Checklist

## 1. Initial npm publish

### One-time setup (manual)

Publishing uses **npm OIDC trusted publishing** — no token, no secret.

1. Create an [npmjs.com](https://www.npmjs.com/) account if you don't have one.
2. On the package page → **Settings** → **Trusted Publisher** → GitHub Actions:
   - Organization or user: `klodr`
   - Repository: `mercury-invoicing-mcp`
   - Workflow filename: `release.yml`
   - Environment: leave empty; Allowed actions: **Publish**
3. That's it: `release.yml` mints short-lived credentials from the
   workflow's OIDC identity at publish time (npm >= 11.5.1, bundled
   with Node 24 in the publish job).

### First publish (manual, locally)

```bash
cd ~/git/mercury-invoicing-mcp
npm login                    # authenticate with npm
npm run build
npm publish --access public  # publishes 0.1.0
```

This creates the package on the npm registry. After this, future releases can be done via GitHub Releases (see below).

## 2. Subsequent releases (automated)

1. Bump the version in `package.json` (and `server.json`):

   ```bash
   npm version patch   # 0.1.0 -> 0.1.1 (or `minor` / `major`)
   ```

2. Push tags: `git push --follow-tags`
3. Create a GitHub Release on the new tag — the `release.yml` workflow will publish to npm automatically.

## 3. Marketplace submissions

Most modern MCP marketplaces auto-discover from GitHub via a `smithery.yaml` or similar. These are already in place. Submit explicitly to seed the discovery:

| Marketplace | URL | Action |
|---|---|---|
| **Official MCP Registry** | https://registry.modelcontextprotocol.io | Submit `server.json` via their CLI or web form |
| **Smithery** | https://smithery.ai | Sign in with GitHub → select repo → auto-detected via `smithery.yaml` |
| **PulseMCP** | https://www.pulsemcp.com/submit | Submit GitHub URL |
| **MCP Store** | https://mcpstore.co/submit | Same |
| **mcpmarket.cn** | https://mcpmarket.cn/submit | Same |
| **MCP Servers (mcpservers.org)** | https://mcpservers.org | Auto-discovered |
| **awesome-mcp-servers** | https://github.com/TensorBlock/awesome-mcp-servers | Manual PR to add to `docs/finance--crypto.md` |

## 4. Launch announcements

| Channel | Content idea |
|---|---|
| X / Twitter | "Just shipped mercury-invoicing-mcp — first Mercury MCP with full Invoicing API support. Automate recurring invoicing from Claude/Cursor/Continue. https://github.com/klodr/mercury-invoicing-mcp" |
| Hacker News (Show HN) | "Show HN: Mercury Invoicing MCP — automate Mercury Bank invoicing from any MCP-aware AI assistant" |
| Reddit r/mcp | Same |
| Mercury developer community | If they have a Slack/Discord, share there |
| LinkedIn | If you have a personal brand around fintech/AI agents |

## 5. PR to awesome-mcp-servers

Add an entry to https://github.com/TensorBlock/awesome-mcp-servers under `docs/finance--crypto.md`:

```markdown
- **[mercury-invoicing-mcp](https://github.com/klodr/mercury-invoicing-mcp)** — Mercury Banking MCP server with full Invoicing API support (one-shot + recurring invoices, customers, attachments).
```
