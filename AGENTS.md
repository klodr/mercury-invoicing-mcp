# AGENTS.md

This repository is **mercury-invoicing-mcp** — a Model Context Protocol
server that wraps the [Mercury Banking](https://mercury.com/) HTTP API,
including full **Invoicing API** support (the first MCP to expose
Mercury's accounts-receivable endpoints). 37 tools across accounts,
cards, categories, credit, customers, invoices, organization,
recipients, statements, transactions, treasury, webhooks.

This file is the **canonical source of truth** for any AI agent that
edits the code in this repository. Read it before making changes. It
encodes the conventions the maintainers actually enforce — not
aspirations.

> If you are an installation agent (i.e. helping a user **install** the
> MCP server in their client config rather than **edit** the server
> code), stop reading this file and read `llms-install.md` instead.
> That file is for the install audience; this one is for code-editing
> agents.

## Audience boundary

| Audience                                           | Source of truth                                |
| -------------------------------------------------- | ---------------------------------------------- |
| Edits this repo's code                             | **`AGENTS.md`** (you are here)                 |
| Installs this MCP into a client config             | `llms-install.md`                              |
| Threat model / security argument                   | `docs/ASSURANCE_CASE.md`                       |
| Disaster recovery / continuity                     | `docs/CONTINUITY.md`                           |
| Forward-looking work                               | `docs/ROADMAP.md`                              |
| Publishing / npm release flow                      | `docs/PUBLISHING.md`                           |
| End-user features and install commands             | `README.md`                                    |
| Vulnerability reporting                            | `.github/SECURITY.md`                          |

Do not duplicate what those documents say. Reference them.

## Setup

Node `>=22.23.1` is **enforced** via `engines` + `engine-strict=true` in
`.npmrc`. CI runs the matrix on Node 22 and 24. `npm install` on Node
21 fails immediately — that is intentional.

```bash
npm install
```

This repo uses **npm**, not pnpm. Lockfile is `package-lock.json`.

Husky hooks install via the `prepare` script.

## Build, test, lint, typecheck

The exact npm scripts (see `package.json`):

| Command                     | What it does                              |
| --------------------------- | ----------------------------------------- |
| `npm run build`             | `tsup` bundle to `dist/`                  |
| `npm run dev`               | `tsup --watch`                            |
| `npm run start`             | `node dist/index.js` (stdio MCP server)   |
| `npm run lint`              | ESLint on `src/`                          |
| `npm run format`            | Prettier write on `src` + `test`          |
| `npm run format:check`      | Prettier check (CI gate)                  |
| `npm run test`              | `vitest run` (also emits JUnit XML)       |
| `npm run test:watch`        | `vitest`                                  |
| `npm run test:coverage`     | `vitest run --coverage`                   |
| `npm run typecheck`         | `tsc --noEmit`                            |

Run `npm run lint && npm run typecheck && npm test` before every push.
Husky's `pre-push` will do it for you, but failing locally before push
is faster than failing in CI.

## Code style

- TypeScript strict (`strictTypeChecked` preset of `typescript-eslint`).
- ESM (`"type": "module"`); use `.js` import specifiers in `src/`.
- ESLint flat config in `eslint.config.js`. Type-aware rules — must
  resolve via `parserOptions.projectService: true`.
- Prettier (no override file → defaults).
- `eqeqeq: error` (always strict equality).
- `no-console: warn` — only `console.error` / `console.warn` allowed.
- `import-x/no-unresolved: off` — TS / vitest already validate imports;
  the rule cannot follow `./*` exports maps from the MCP SDK.

## Tests

- Framework: **vitest** with `globals: true`.
- Lives in `test/`, name pattern `*.test.ts`.
- Setup file: `test/setup.ts` (registered via `setupFiles`).
- Coverage provider: `v8`. Reporters: `text`, `lcov`, `json`. The JSON
  report carries per-branch hit counts so Codecov can compute accurate
  indirect-changes — do not remove it.
- `src/index.ts` is excluded from coverage (stdio entry point;
  testing it requires process/stdio mocking that adds complexity
  disproportionate to its coverage value). The actual logic lives in
  `src/server.ts` and is covered there.
- Use `InMemoryTransport` from `@modelcontextprotocol/sdk` for
  end-to-end handler tests. Existing tests in `test/` are the
  reference pattern.

## Commits

- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`, `ci:`, `build:`).
- **Signed commits required.** Pre-push hook verifies via `%G?` and
  rejects anything other than `G`/`U`/`E`. Configure SSH commit
  signing or set `commit.gpgsign=true`.
- **Subject ≤72 characters.** Pre-push counts unicode code points
  (not bytes) so emoji and accented characters count correctly.
- **No `Co-Authored-By:` trailers.** This repo's maintainers do not
  use co-authorship attribution on AI-assisted commits.

## Pre-push gate (`.husky/pre-push`)

For every new commit being pushed:

1. Signature is `G`/`U`/`E`.
2. Subject ≤72 chars (unicode-aware).

Then once per push:

1. `npm run format:check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test`
5. `npm audit --audit-level=high`

Bypass with `git push --no-verify` only when the hook itself is wrong
(rare). The bypass is recorded in the local reflog.

## PR workflow

- Open the PR against `main`.
- Wait for CodeRabbit review (assertive profile). Drain every
  comment thread before re-pinging — never spam `@coderabbitai
  review` while threads are unresolved.
- CodeRabbit commands are posted **bare**, no surrounding prose
  (e.g. a comment whose entire body is `@coderabbitai review`).
- Do not let CodeRabbit push commits — this repo is solo-maintained
  and a bot commit would block merge under branch protection.
- Auto-merge: `gh pr merge --squash --auto`. Branch protection waits
  on CI + CodeRabbit + Scorecard.
- Maintainers do not self-approve their own PRs. Approvals only
  from external bots (release-please-app, dependabot).

## Source layout

```text
src/
  index.ts            stdio entry point (excluded from coverage)
  server.ts           MCP server wiring + tool registration
  client.ts           Mercury HTTP client (fetch + retry)
  middleware.ts       audit log + dry-run + redaction
  sanitize.ts         audit-log redaction
  safe-url.ts         SSRF guard
  tools/
    _shared.ts        defineTool helper + textResult helper
    accounts.ts       account listing + balance
    cards.ts          card listing
    categories.ts     transaction categories
    credit.ts         credit accounts + transactions
    customers.ts      customer CRUD
    invoices.ts       invoice CRUD (Mercury Invoicing API)
    organization.ts   org metadata
    recipients.ts     payment recipients
    statements.ts     statement listing + download
    transactions.ts   transaction listing + send-money
    treasury.ts       treasury balance + transactions
    webhooks.ts       webhook CRUD
    index.ts          registrar entry point
  prompts/            prompt templates
test/
  *.test.ts           vitest specs
  setup.ts            global setup (fixtures, mocks)
docs/
  ASSURANCE_CASE.md   security argument (threat model + mitigations)
  CONTINUITY.md       disaster recovery / continuity plan
  PUBLISHING.md       npm publish + provenance flow
  ROADMAP.md          forward-looking work
```

## Tool registration pattern

All tools register via the `defineTool` helper in
`src/tools/_shared.ts`. The signature is:

```ts
defineTool(
  server,
  "mercury_<resource>_<verb>",   // tool name
  "<purpose / USE WHEN / DO NOT USE / RETURNS> ...",  // description
  zodInputSchema,                // input schema
  async (args) => { /* handler */ },
);
```

Tool descriptions follow a **structured pattern** (USE WHEN, DO NOT
USE, RETURNS) so LLMs route correctly. Match the existing tools when
adding new ones — that pattern is what keeps the 37-tool surface
discoverable.

## Security guards encoded in the code

The security posture is described in full in `docs/ASSURANCE_CASE.md`.
What follows is the minimum an editor must know to avoid regressing it:

- **No write tools without explicit opt-in**: send-money is gated
  behind a separate request flow (`request_send_money`), not direct
  `send_money`. Do not add silent write paths.
- **SSRF guard**: `safe-url.ts` rejects non-Mercury hosts. Bearer
  token + invoice payloads only ever leave to `api.mercury.com`.
- **Audit-log redaction**: `sanitize.ts` keeps an explicit allowlist
  of fields in clear, blocks credential fields, elides everything
  else with `[ELIDED:NNN]`. Adding a new tool that takes free-form
  input → extend the test, not the allowlist.
- **Mercury-specific error mapping**: 422 line-item errors are
  surfaced with the exact field path so the LLM can correct the
  invoice. The 200-character limit on `name` is enforced in the zod
  schema (Mercury rejects longer values on the edit endpoint with a
  message that leaves the invoice unmodifiable).

## Before opening a PR — checklist

1. `npm run format && npm run lint && npm run typecheck && npm test`
2. New behaviour has a test. New error path has a test.
3. New tool follows the `defineTool` pattern with USE WHEN / DO NOT
   USE / RETURNS sections.
4. Commit subject ≤72 chars, signed, conventional, no Co-Authored-By.
5. If you touched a security guard listed above: also re-read the
   matching section in `docs/ASSURANCE_CASE.md` and update it if the
   threat model shifted.
6. If you changed user-facing behaviour: update `README.md` and the
   relevant section of `llms-install.md`.
7. If you added an npm-relevant change (new files, new exports):
   re-read `docs/PUBLISHING.md`.
