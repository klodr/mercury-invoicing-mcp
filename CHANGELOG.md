# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.0] - 2026-04-25 — Tool descriptions polish

A documentation-quality release. Every one of the 36 tool definitions across 12 modules is rewritten in a structured TDQS form (USE WHEN / DO NOT USE / SIDE EFFECTS / RETURNS), driven by an LLM-agent-orientation review and cross-validated against [Anthropic — Writing Tools for Agents](https://www.anthropic.com/engineering/writing-tools-for-agents), the [MCP Tools Specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), and [SEP-1382](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1382). One technical-accuracy fix: the previously-claimed singular-vs-plural path distinction between `mercury_list_transactions` and `mercury_list_credit_transactions` was inaccurate (both hit the SINGULAR `/account/{id}/transactions` path) — corrected. Two small dependency-hygiene fixes ride along (`packageManager` and `pnpm.onlyBuiltDependencies` pinned for reproducibility on pnpm-based registries). No runtime, schema, or contract changes.

### Changed

- **Tool descriptions adopt the TDQS pattern** — every one of the 36 tool definitions across 12 modules (`accounts`, `cards`, `categories`, `credit`, `customers`, `invoices`, `organization`, `recipients`, `statements`, `transactions`, `treasury`, `webhooks`) is restructured into explicit USE WHEN / DO NOT USE / SIDE EFFECTS / RETURNS sections. Read-only tools (21) drop the trivial `SIDE EFFECTS` line — the `list_/get_` prefix already encodes the property. Write tools (10) surface persistence, idempotency keys, and email side-effects (`create_invoice` with `sendEmailOption: "SendNow"`). Destructive + money-moving tools (5) carry explicit `REAL FUNDS` / `irrecoverable` / `ALWAYS confirm with user` warnings: `send_money`, `request_send_money`, `delete_customer`, `cancel_invoice` (with the customer-facing email notice), `delete_webhook`. `mercury_send_money` documents the workspace approval policy semantics (immediate execution depends on Mercury's own Settings → Approvals, not on the MCP).
- **Disambiguation of overlapping account / transaction surfaces** — `mercury_list_accounts` (deposit) vs `mercury_list_credit_accounts` (IO Credit) vs `mercury_get_treasury` (Treasury cash); `mercury_list_transactions` vs `mercury_list_credit_transactions` vs `mercury_list_treasury_transactions`; `mercury_create_customer` (AR billable) vs `mercury_add_recipient` (payment counterparty); `mercury_send_money` vs `mercury_request_send_money` vs `mercury_create_internal_transfer` (workspace-policy-dependent immediate execution vs always-pending-approval vs no-recipient internal sweep). All cross-referenced in the `DO NOT USE` of each pairing.
- **Drop misleading singular-vs-plural path claim** — both `mercury_list_transactions` and `mercury_list_credit_transactions` hit the SINGULAR `/account/{id}/transactions` path. The previous "PLURAL `/accounts/{id}/transactions`" comparison in `credit.ts`'s header comment and in the inline description was inaccurate; the plural path is never invoked anywhere in the codebase. Caught by CodeRabbit on the TDQS PR.
- **`packageManager` field pinned to `npm@10.9.7`** — matches the npm version bundled with Node 22.22.2 (our `engines.node` floor), so Corepack stays a no-op for default Node 22 installs and a no-cost pin elsewhere. Stops a contributor or CI runner with an older npm from regenerating a lockfileVersion 2 lockfile.
- **`pnpm.onlyBuiltDependencies: ["esbuild"]`** — pnpm-based registries (Glama, Smithery, etc.) can now build cleanly without operator-prompt for esbuild's post-install hook. Other transitive post-install scripts stay blocked.
- **README MIT badge dropped** — license is already surfaced by GitHub (sidebar, auto-detected from `LICENSE`) and npm (right rail, parsed from `package.json` `license`). The third copy in the README was noise without information.

### Added

- **`docs/ROADMAP.md` — MCP `outputSchema` per tool item** — extend `defineTool()` with an optional `outputSchema?: ZodRawShape` and write a Zod schema for each of the ~36 tools so clients can validate `structuredContent` per MCP spec 2025-06-18+. Lets us drop the textual `RETURNS:` block from tool descriptions and rely on a machine-readable contract instead.

## [0.11.0] - 2026-04-25

### Added

- **Community-health files** — `.github/SUPPORT.md` (issue-redirection page surfaced by GitHub on issue creation, with best-effort response SLOs) and `CITATION.cff` (Citation File Format metadata enabling the GitHub "Cite this repository" button on the repo page).
- **`package.json` discoverability** — `funding` field now points at `https://github.com/sponsors/klodr` (renders as the ❤️ Sponsor button on `npmjs.com`). `CHANGELOG.md` added to the `files` allowlist so it stays in the published tarball — npm v11 dropped `CHANGELOG.md` from the always-included list, so consumers who read changelog from `node_modules/` would otherwise see it disappear silently.

### Changed

- **Socket Security stricter posture (aligned with `klodr/gmail-mcp`)** — `socket.yml` no longer silences the three high-value supply-chain alerts `unstableOwnership`, `unmaintained`, and `manifestConfusion`. The original blanket-suppression (PR #39, 2026-04-19) was preventive against the `@modelcontextprotocol/sdk → express` transitive surface tracked in [modelcontextprotocol/typescript-sdk#1924](https://github.com/modelcontextprotocol/typescript-sdk/issues/1924), but in practice `express` is actively maintained with stable ownership, so the rules generate near-zero noise. They will now fire on transitive owner changes / abandonware / manifest mismatch — exactly the supply-chain attack surface that hit `event-stream`, `ua-parser-js`, `nx`. Per-package `@SocketSecurity ignore <pkg>@<version>` comments on the relevant PR remain available if a transitive dep generates a real false positive.
- **Repository structure cleanup** — community-health files (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`) moved to `.github/`, and general documentation (`ROADMAP.md`, `ASSURANCE_CASE.md`, `CONTINUITY.md`) moved to `docs/`. Internal links updated across `README.md`, `llms-install.md`, `docs/ASSURANCE_CASE.md`, `docs/CONTINUITY.md`, `docs/ROADMAP.md`, `src/{sanitize,middleware}.ts`, `src/tools/credit.ts`, `src/prompts/recipes.ts`, and `.github/workflows/verify-release.yml`. The repository root now keeps only `README.md`, `LICENSE`, `CHANGELOG.md`, `llms-install.md`, and project-config files. No behaviour change; GitHub still resolves the community files at their new canonical locations.
- **README "Why this MCP?" comparison row reworded** — the prior `Hosted (no token to manage)` line implied the hosted Mercury MCP's lack of token was a feature klodr lacked. In practice, the hosted MCP requires frequent OAuth re-authentication, while a long-lived, IP-allowlistable token (used by both `dragonkhoi/mercury-mcp` and this server) is the more operational option. The row is now `Stable token (no frequent re-auth, IP-allowlistable)` to describe each MCP factually.

## [0.10.0] - 2026-04-23

### Added

- **MCP slash-command prompts (8 total)** — LLM clients that support the MCP Prompts capability can now invoke high-level workflows as slash commands: `/mercury-send-ach`, `/mercury-create-recipient`, `/mercury-accounts-overview`, `/mercury-recipients-overview`, `/mercury-create-customer`, `/mercury-create-invoice`, `/mercury-unpaid-invoices-overview`, `/mercury-pending-card-transactions`. Each prompt wires the right tools with the right scopes and the right safeguards (confirmation gates, forbidden-tools list, NACHA memo validation, amount floor at $0.01, ACH routing/account co-dependency via `us-bank-account-validator`). All user-supplied arguments go through `promptSafe()` (NACHA allowlist: alphanumerics plus <code>( ) ! # $ % &amp; ' * + - . / : ; = ? @ [ ] ^ _ { | }</code>) before interpolation, so a crafted slot value can no longer break out with a quote+newline or smuggle a backtick-substitution. Prompt source: `src/prompts/{recipes,invoicing,credit,_shared}.ts`; covered by 41 end-to-end tests. (#82)
- **Mercury IO Credit account exposure (2 tools)** — `mercury_list_credit_accounts` wraps `GET /credit` (documented under [Credit › List all credit accounts](https://docs.mercury.com/reference/credit) in the Mercury API reference) and `mercury_list_credit_transactions` wraps `GET /account/{id}/transactions` (SINGULAR path used for IO Credit transactions, distinct from the plural `/accounts/{id}/transactions` used for deposit accounts). These power the "pending card transactions" recipe above. Tool count: 34 → 36. (#83)
- **`.strict()` schema wrapping in `defineTool`** — every tool's `inputSchema` is now wrapped in `z.object(shape).strict()` before being registered, so unknown keys in an LLM-generated tool call are rejected at parse time instead of silently dropped. Defense against prompt-injection payloads that smuggle extra fields past validation.

### Changed

- **README / CONTRIBUTING emoji tagging** — every top-level heading carries a single-glyph emoji (🏦 ✨ 📦 ⚙️ 🔑 ⚠️ 🧪 🤖 🖱️ 🦀 🛠️ 🗺️ 🔒 🛡️ 🔧 💡 📄 🤝), the three safeguards and the PR checklist render as numbered 1️⃣ 2️⃣ 3️⃣ callouts, and the `Tools` list gains per-domain icons that line up with the banking / AR / webhooks split (🏦 Accounts / 💳 IO Credit / 💸 Transactions / 👥 Recipients / 📊 Statements / 🏛️ Treasury / 🧾 Invoicing / 👤 Customers / 🔗 Webhooks). Pure visual diff, zero change to the prose or to any tool behaviour. (#84)
- **Node.js floor pinned to exact `>=22.22.2`** (was `>=22.22`, originally `>=22.11`). The previous `>=22.22` range accepted `22.22.0` and `22.22.1`, which predate the seven CVEs fixed in `22.22.2`. The CVEs addressed: [CVE-2026-21637](https://nvd.nist.gov/vuln/detail/CVE-2026-21637) (High — SNICallback invocation error handling in TLS), [CVE-2026-21710](https://nvd.nist.gov/vuln/detail/CVE-2026-21710) (High — prototype pollution in HTTP header processing), [CVE-2026-21713](https://nvd.nist.gov/vuln/detail/CVE-2026-21713) (Medium — non-timing-safe comparison in WebCrypto HMAC), [CVE-2026-21714](https://nvd.nist.gov/vuln/detail/CVE-2026-21714) (Medium — NGHTTP2 flow-control error handling), [CVE-2026-21717](https://nvd.nist.gov/vuln/detail/CVE-2026-21717) (Medium — V8 array index hash collision), [CVE-2026-21715](https://nvd.nist.gov/vuln/detail/CVE-2026-21715) (Low — missing permission check in `realpath.native`), [CVE-2026-21716](https://nvd.nist.gov/vuln/detail/CVE-2026-21716) (Low — missing permission check in `fs/promises`). Pinning to the exact patch closes the gap so a fresh `npm install` cannot land on a pre-CVE runtime. Aligned with `klodr/gmail-mcp`, `klodr/faxdrop-mcp` (shipped in PR #71), and the private `klodr/relayfi-mcp`. Also updates `README.md` comparison-table row, `SECURITY.md` "Supported runtimes", `llms-install.md` prerequisite, and `.github/dependabot.yml` `@types/node` major-clamp comment.

### Fixed

- **Audit throws no longer mask handler errors** (Qodo finding backported from `klodr/gmail-mcp#48`). A `logAudit(...)` call in the `finally` or `catch` would override the handler's own exception per JS/TS semantics — so a full-disk or a circular-`args` `JSON.stringify` throw inside the audit helper could erase the root cause from the caller. Introduces a local `safeLogAudit` wrapper that swallows any audit-side exception to stderr and applies it to all five terminal audit-log calls (rate-limit catch → `"error"`, `"dry-run"` early-return, `"ok"` success path, `"error"` catch before the `MercuryError` mapping, and the new `"error"` before a non-`RateLimitError` re-throw — previously missing, see next bullet). The runtime audit-`result` values on mercury are `"ok" | "dry-run" | "error"` (gmail also has a `"rate_limited"` state, mercury doesn't).
- **Non-`RateLimitError` re-throw now logs an audit entry**. If `enforceRateLimit` ever throws something other than `RateLimitError` (a future regression in rate-limit state handling, a programming bug), the audit trail now shows the event before the re-throw propagates. The path is marked `v8 ignore` because it is not reachable from the current implementation.
- **Business errors returned via `isError: true` are now audited as "error"** (Qodo finding backported from `klodr/gmail-mcp#48`). Previously, handlers that surfaced a failure through the MCP `isError` channel (vs a thrown exception) were audited as `"ok"`, conflating successful calls with handler-side failures in the audit log. `wrapToolHandler` now inspects `result.isError` on the success path and picks the audit state accordingly.

## [0.9.2] - 2026-04-23

### Fixed

- **CodeQL Code Scanning alert #28** (`src/sanitize.ts`) — the control-character stripping regex is now spelled with explicit `\uXXXX` escapes instead of literal C0/C1 characters embedded in the source. Functionally identical, but the literal form tripped CodeQL's "invisible Unicode" rule. No runtime behaviour change.
- **CI `Upload test results to Codecov` guard** — the step now reads `if: ${{ always() && matrix.node == '22' && !cancelled() }}`. The prior `if: matrix.node == '22' && !cancelled()` was ambiguous: `!cancelled()` alone does replace the implicit `success()` check in GitHub Actions expression semantics, but the ambiguity is enough that failed test runs were at risk of being filtered out of Test Analytics — defeating the entire point of the upload (seeing flaky-test patterns on red builds). Explicit `always()` makes the "upload on failure" behaviour load-bearing in the YAML itself.
- **README CodeRabbit badge URL** — dropped the `utm_source=oss&utm_medium=github&utm_campaign=klodr%2Fmercury-invoicing-mcp&` prefix from the `img.shields.io/coderabbit/prs/...` badge URL. Those params are what CodeRabbit's "embed this badge" snippet proposes by default, but shields.io doesn't interpret them — they only serve to give the URL a unique signature from the other sibling-repo badges, which means GitHub's camo image proxy caches each variant independently. When the upstream CodeRabbit endpoint returned a transient `provider or repo not found` at camo's initial fetch, that error SVG got cached and kept rendering while the sibling-repo badge (with a different URL) rendered fine. Dropping the utm params aligns the badge URL with the form used on `klodr/gmail-mcp` and invalidates the stale camo cache on the next README render.

### Changed

- **Node.js floor tightened to `>=22.11`** (was `>=22`). `22.11.0` is the LTS-tagged entry point for the Node 22 "Jod" line (October 2024); the previous `>=22` would have accepted the pre-LTS `22.0`–`22.10` releases which predate the LTS designation. Aligned with the sibling repos `klodr/faxdrop-mcp` and `klodr/gmail-mcp`, all moving to the same floor.
- `.github/dependabot.yml` `@types/node` major-version-clamp comment aligned to the new `>=22.11` floor.
- `llms-install.md` prerequisite updated to **Node.js ≥ 22.11**.
- `SECURITY.md` "Supported runtimes" section updated to state `Node.js ≥ 22.11` with the LTS-tag rationale.
- `README.md` comparison table gained a **Node.js floor** row making the three-way posture explicit (hosted N/A, `dragonkhoi/mercury-mcp` ships without `engines.node` so installs silently on Node 14 EOL, `mercury-invoicing-mcp` enforces `>=22.11` at the manifest level).
- **Coverage ignore comments renamed from `/* istanbul ignore next */` to `/* v8 ignore next */`** to match the V8 coverage provider actually used under vitest. Functionally identical; aligns the syntax with the tool doing the work.

### Added

- **Codecov Test Analytics wiring** — vitest emits a `test-results.junit.xml` alongside its default human reporter, and the CI run uploads it to Codecov via `codecov/codecov-action@v6.0.0` (pinned by SHA) invoked with `report_type: test_results` — the standalone `codecov/test-results-action@v1.2.1` is deprecated in favour of the unified action. Gives us the "Tests" dashboard on codecov.io: per-suite flaky-test detection, slowest tests, test failure history. Upload runs only on the Node 22 matrix leg with `!cancelled()` so a test failure still surfaces the report. XML file is in `.gitignore` and excluded from the published tarball (not in `package.json#files`).
- **`glama.json` at the repo root** — claims ownership of the `klodr/mercury-invoicing-mcp` listing on glama.ai (MCP server registry), so the automated scanner pairs the listing with this repo rather than an unclaimed fork.

## [0.9.1] - 2026-04-22

Single focus: move the whole toolchain off Node 20 ahead of its 2026-04-30 end-of-life. Not a feature release — `dist/index.js` behaviour is unchanged versus 0.9.0.

### Changed (BREAKING)

- **Node.js floor: `>=22`** (was `>=20.11`). Node 20 reaches end-of-life on 2026-04-30; keeping the floor there would ship 0.9.0-era packages on an unmaintained runtime the day after. Node 22 is in Maintenance LTS through 2027-04-30, which gives a year of headroom before the next cadence bump.
- **Compile target: `ES2024`** (was `ES2023`). Node 22 implements the full ES2024 surface (`Object.groupBy`, `Map.groupBy`, `Promise.withResolvers`, iterator helpers, etc.) — the TypeScript `target` and `lib` now match, so stdlib additions don't need polyfills.
- **Bundle target: `tsup target: node22`** (was `node20`). Without this the bundler kept down-levelling Node 22 intrinsics (WebCrypto globals, `AbortSignal.any`) and the shipped `dist/index.js` wasn't actually exploiting the higher floor we just set.

### Changed

- `@types/node` bumped from `^20.19.0` to `^22.19.17` so the TypeScript definitions line up with the runtime floor.
- CI matrix dropped Node 20 — builds now run on Node 22 + 24. The coverage-upload step (Codecov) moved from Node 20 to Node 22.
- Release and verify-release workflows set up Node 22 (`setup-node node-version: "22"`).
- Dockerfile base image pinned to `node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f` (digest resolved via Docker Hub API at release time).
- `package-lock.json` refreshed via `npm update` — minor bumps within existing carets, no semver-major shifts.

### Added

- `.nvmrc` with `22` so `nvm use` in a fresh checkout matches `engines.node` and the CI matrix without guessing.
- `SECURITY.md` gained a **Supported runtimes** section stating the Node 22 floor and the LTS window.
- `ROADMAP.md` item **Node.js 22 migration** ticked off; `dependabot.yml` `@types/node` pin comment now references the 22.x line.
- Issue-template `bug_report.yml` / `CONTINUITY.md` / `ASSURANCE_CASE.md` / `llms-install.md` scrubbed of stray Node 20 / `20.11` references.

## [0.9.0] - 2026-04-22

### Added

- **External AI review tier** via Qodo Merge (`.github/workflows/qodo-merge.yml`). Every PR now gets three independent AI reviews in parallel: CodeRabbit (GPT lineage), DeepSeek R1 (reasoner, explicit chain-of-thought), and Gemini 3.1 Pro Preview (thinking mode). `qodo-ai/pr-agent@v0.34` pinned by SHA, `/review` only (no auto-description, no commitable suggestions), fork PRs and drafts skipped, 15-min timeout, `persistent_comment=false` so each model lands its own comment. Triangulates findings across three model families — the failure mode of one lineage is rarely the failure mode of the others.

### Security

- **Webhook URL validator tightened** (M-01). `mercury_create_webhook` / `mercury_update_webhook` now require `https://` and reject any hostname that resolves to a loopback, RFC 1918 private, link-local, cloud-metadata, or private-IPv6 range — IPv4 via numeric CIDR match (`127/8`, `10/8`, `169.254/16`, `192.168/16`, `172.16/12`, plus `0.0.0.0/8`), IPv6 via bitmask on the first hextet (`fc00::/7`, `fe80::/10`). The previous `z.string().url()` let `http://`, `file://`, `data:`, `ftp://` through even though the tool description said HTTPS. A prompt-injected agent that reached the webhook API of this MCP would otherwise have registered `http://attacker.tld` and siphoned every subsequent Mercury event (transactions, invoices, balances) in clear. Defense-in-depth: Mercury almost certainly validates upstream too, but validating here keeps the hostile URL out of Mercury's audit trail and surfaces the failure to the operator instead of a generic 400.
- **LLM ping-pong injection sanitized** (M-02). Every JSON value returned by the Mercury API is walked and stripped of ASCII control characters, zero-width characters (U+200B-U+200F, U+202A-U+202E, U+2060, U+FEFF), BiDi control marks, and the BOM before reaching the LLM. Errors are fenced in a `<untrusted-tool-output>` block so a prompt embedded inside an invoice description, a recipient name, or a transaction memo cannot hijack the tool-calling agent by echoing back crafted instructions. JSON structure is preserved verbatim — no double-wrapping, no lossy re-encoding.
- **Local write rate limiter** visible in audit: `webhooks_create` caps at 2/day by default. The test suite exercises `MERCURY_MCP_RATE_LIMIT_DISABLE=true` via a snapshot-and-restore pattern so a shared env var set by the test runner survives the run.

## [0.8.6] - 2026-04-22

### Changed

Republish of 0.8.5. The CHANGELOG `[0.8.5]` narrative and the GitHub Release body for v0.8.5 originally quoted the maintainer's personal email addresses verbatim, which partly defeated the privacy migration 0.8.5 was meant to enact. `main` has since been corrected in place; 0.8.6 ships the corrected CHANGELOG to npm. No code, schema, or runtime behaviour change — `dist/index.js` is byte-equivalent to what 0.8.5 shipped. 0.8.5 will be withdrawn once 0.8.6 is published: the GitHub Release will be deleted and the npm version will be unpublished (within the 72-hour window).

## [0.8.5] - 2026-04-22

### Security & privacy — clean-slate republish

This release supersedes **all** prior 0.x versions of `mercury-invoicing-mcp`. The reasons are strictly hygiene, not a change in the wire-level behaviour consumers rely on:

- **Commit-metadata privacy**: `main` was historically authored under two of the maintainer's personal email addresses. `main` has been rewritten so that every commit, every `Signed-off-by:` trailer, and every `Co-authored-by:` line carries `klodr@users.noreply.github.com` instead. 101 of the 101 commits on the new `main` carry a verified SSH signature; 95 are authored by the maintainer, 6 by Dependabot.
- **Supply-chain contract actually deliverable**: the `SECURITY.md` of earlier releases advertised SBOM attestations verifiable with `gh attestation verify --predicate-type https://spdx.dev/Document/v2.3`. That was never true on 0.8.4 and earlier — the two `actions/attest` steps lacked `id:` fields, so their signed `.sigstore` bundles were never captured and never uploaded. Starting with 0.8.5 the promise is actually met: the bundles are referenced via `${{ steps.attest_spdx.outputs.bundle-path }}` / `${{ steps.attest_cdx.outputs.bundle-path }}`, copied to `dist/sbom.spdx.sigstore` / `dist/sbom.cdx.sigstore`, and uploaded to the Release alongside the JSON SBOMs.
- **npm `--ignore-scripts` on publish**: the `prepublishOnly` build hook needs `tsc`/`tsup`, which the earlier `npm prune --omit=dev` step (run before SBOM generation) removes. `npm publish --access public --provenance --ignore-scripts` now skips the redundant re-build — the dist/ artefact produced earlier in the job is what ships, with its own Sigstore signature.

### What this means for consumers

- **`npm install mercury-invoicing-mcp@0.8.5`** produces an install that is **functionally identical** to what 0.8.4 would have shipped — the bundled `dist/index.js` carries the same tools, same schemas, same Zod bounds, same rate-limit middleware, same FaxDrop/Mercury client.
- **`npm install mercury-invoicing-mcp@0.7.4`** (the previous stable on npm) still works; that version is deprecated with a pointer to 0.8.5, but not unpublished.
- **Every 0.x tag other than `v0.7.4`** has been removed from the GitHub repository — those tags pointed to pre-rewrite SHAs that are no longer reachable from `main` and their npm counterparts (0.7.5 through 0.8.3) had already been unpublished from the registry within the 72-hour window. Removing the orphan tags keeps the tag history coherent with what's actually installable.

### Technical scope (content-wise identical to 0.8.4)

- Docker MCP Registry submission path — Dockerfile, `.github/icon.png`, `.github/workflows/docker.yml` (multi-stage, `node:20-alpine` digest-pinned, non-root `mcp` user, OCI labels, `HEALTHCHECK NONE`, strict smoke-test)
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 (OpenSSF Silver requirement)
- `ROADMAP.md` extracted from the README, Node.js 22 migration tracked with the 2026-04-30 deadline
- Dual-reviewer-friendly `.coderabbit.yaml` — `finishing_touches.docstrings.enabled: false`, `finishing_touches.unit_tests.enabled: false` so CodeRabbit never auto-commits against the branch-protection `require_last_push_approval` gate

## [0.8.4] - 2026-04-22

### Added

- **Dockerfile + `.github/icon.png`** — container distribution path for the Docker MCP Registry submission. Multi-stage, `node:20-alpine` pinned by digest, non-root `mcp` user, OCI labels (`version` from build-arg), no EXPOSE, explicit `HEALTHCHECK NONE` to silence Checkov `CKV_DOCKER_2` on stdio images.
- **`CODE_OF_CONDUCT.md`** — Contributor Covenant 2.1, required for OpenSSF Silver.
- **`.github/workflows/docker.yml`** — buildx + GHA cache, asserts required OCI labels + non-root `USER=mcp`, strict smoke-test of the entrypoint.

### Changed

- **Roadmap extracted to `ROADMAP.md`** (no longer inlined in the README) and Silver-tier wording consolidated. Purely a docs reshuffle; the repo content covered by OpenSSF Best Practices is unchanged.
- `.github/dependabot.yml` — `@types/node` major-version-clamp comment aligned with `engines.node` floor.

## [0.8.2] - 2026-04-21

### Added

- Funding links in `.github/FUNDING.yml` (GitHub Sponsors, Patreon,
  Ko-fi) and matching badges at the top of the README. Monthly
  recurring funding helps cover the tooling (Claude Code, Socket
  Security, CI) behind steady security patches and issue triage.

### Changed (BREAKING for env overrides + state file)

- **Dual-window rate limits**: every write tool now enforces both a daily
  and a 30-day rolling cap, rejecting calls as soon as either window is
  at its limit. Previously only a daily cap existed, so a slow agent
  could spread enough calls across weeks to drain an account while
  staying under the daily threshold.
- Per-category limits replaced with finer-grained **per-bucket limits**
  (see README for the full matrix). Example: `create_customer` /
  `update_customer` / `delete_customer` now share a `customers_write`
  bucket capped at 3/day, 60/month (previously pooled under `invoicing`
  at 100/day with no monthly cap).
- Rate-limit env override format changed from
  `MERCURY_MCP_RATE_LIMIT_<category>=N/day` to
  `MERCURY_MCP_RATE_LIMIT_<bucket>=D/day,M/month` — both windows must
  be supplied. Old-format values now fall back to the built-in default
  (with a stderr warning) instead of being silently mis-parsed.
- Rate-limit state file (`~/.mercury-mcp/ratelimit.json`) is now keyed
  by bucket name. Pre-existing state keyed by category (`money`,
  `invoicing`, …) is ignored on first load after upgrade — effectively
  a fresh 30-day window starts from the upgrade moment.
- Rate-limit errors now return a structured JSON payload with
  `source: "mcp_safeguard"`, `error_type` (`mcp_rate_limit_daily_exceeded`
  or `mcp_rate_limit_monthly_exceeded`), `message`, `hint`, and
  `retry_after` (ISO 8601 timestamp) — unambiguously distinct from a
  server-side Mercury 429 (which surfaces separately as
  `"Mercury API error 429: …"` via the `MercuryError` branch).
- `.coderabbit.yaml` now carries an explicit policy NOTE forbidding
  CodeRabbit-authored commits: on a solo-maintainer repo the branch
  protection rule "approval from someone other than the last pusher"
  deadlocks if the bot is both the last pusher and the approver. The
  NOTE complements the existing
  `pre_merge_checks.override_requested_reviewers_only: true` gate with
  explicit human discipline (never click "Commit suggestion", never
  run `@coderabbitai apply suggestions`).
- `SECURITY.md` updated to describe the dual-window design and clarify
  that `isError: true` lives on the `ToolResult` as a sibling of the
  `content` array (set by `wrapToolHandler`), while the structured
  JSON payload with `source` / `error_type` is inside
  `content[0].text` (returned by `formatRateLimitError`).
- `dependabot.yml`: drop `include: "scope"` (was producing duplicated
  titles like `deps(deps): bump X` / `deps-dev(deps-dev): bump X`
  because the prefix already encodes prod vs dev). Reduce
  `open-pull-requests-limit` from 10 to 5 to keep the review queue
  manageable.

### Security

- Monthly cap blocks a drain-by-pacing attack that the previous
  single-window limiter could not catch: e.g. 7 `send_money` calls per
  day × 30 days = 210 outbound payments that used to pass silently.
  The new 150/month cap on `payments` stops this at 150.

## [0.8.1] - 2026-04-19

### Changed

- `codecov.yml`: revert `project.threshold` from `1.5%` to `0.5%` now that
  v0.8.0 has shipped and codecov has a clean v8-instrumented baseline.
  The 1.5% was a one-shot accommodation for the istanbul → v8
  instrumentation switch; PRs from here on compare like-for-like.
  Patch threshold (`95%` / `1.5%`) is unchanged.
- `socket.yml`: flip the intrinsic-behavior alerts (`envVars`,
  `filesystemAccess`, `networkAccess`, `urlStrings`, `hasIPProxy`) from
  `true` to `false`. These rules aren't in Socket's default-enabled set,
  so the previous `true` opted us IN to the warnings instead of silencing
  them. The behaviors themselves (env-var reads, fetch calls, etc.) are
  intentional for an MCP server that talks to an external API.

## [0.8.0] - 2026-04-19

### Security

- Tighten date validation on every `YYYY-MM-DD` tool input (12 fields
  across `invoices`, `statements`, `transactions`, `treasury`).
  `z.string().describe("YYYY-MM-DD")` had no actual validation —
  arbitrary strings were forwarded to Mercury. Now uses zod 4's
  `z.iso.date()` (strict ISO date format).

### BREAKING

- **Drop Node 18.** Minimum runtime is now **Node 20.11+** (Node 18 is past
  EOL; the 20.11 floor is required by `import.meta.dirname` in
  `eslint.config.js`). `engines.node` is `>=20.11`, the CI matrix is
  `[20, 22, 24]`, and tsup target is `node20`.

### Changed

- **Major dep bumps** (all green on the test suite):
  - `zod` 3.25 → **4.3.6**. `z.string().uuid()` is now strict v1-v8 (or nil/max);
    13 fake UUIDs in `test/integration.test.ts` migrated from `00000000-...` to
    `00000000-0000-4000-8000-...` (valid v4 pattern, suffix preserved). MCP SDK
    1.29 already supports `^3.25 || ^4.0`.
  - `typescript` 5.9 → **6.0.3** (no source change required).
  - `eslint` 9.39 → **10.2.1** + `@eslint/js` 9.39 → **10.0.1**. The new
    `no-useless-assignment` rule flagged a redundant `let json = undefined`
    initializer in `src/client.ts:76` (now `let json: unknown;`).
  - `@types/node` 22 → **20.19.0** (matches `engines.node >=20.11`; previously
    bumped to 25 then walked back so typings can't introduce Node 21+ APIs).
- **Minor dep bumps**:
  - `@modelcontextprotocol/sdk` 1.25 → **1.29.0**
  - `tsup` 8.3 → **8.5.1**
- **Test runner: jest → vitest** (`vitest@4.1.4` + `@vitest/coverage-v8`).
  Drops `jest`, `@types/jest`, `ts-jest` and their deprecated `glob@10`
  / `inflight` / `babel-plugin-istanbul` transitives
  ([jestjs/jest#15173](https://github.com/jestjs/jest/issues/15173)).
  Native ESM/TS, no preset. v8 coverage instead of istanbul. API is
  drop-in: `jest.fn`/`jest.spyOn` → `vi.fn`/`vi.spyOn`.
- **GitHub Actions bumps** (SHA-pinned):
  - `actions/checkout` → **v6.0.2**
  - `actions/setup-node` → **v6.3.0**
  - `actions/upload-artifact` → **v7.0.1**
- `eslint.config.js`: replaced the Node 18 `dirname(fileURLToPath(import.meta.url))`
  shim with the native `import.meta.dirname` (Node 20.11+). Drops the
  `node:path` and `node:url` imports.

### Documentation

- `CONTINUITY.md`, `ASSURANCE_CASE.md`: updated CI matrix mention from
  Node 18/20/22 to Node 20/22/24.

## [0.7.9] - 2026-04-19

### Fixed

- `.github/workflows/verify-release.yml` — drop `--signer-workflow` from
  `gh attestation verify` (Path 2). The current `gh` CLI rejects the
  combination with `--cert-identity` (mutually exclusive flag group),
  so the post-release verify job exited 1 on every release since 0.7.6
  without performing any actual verification. `--cert-identity` is
  strictly more specific (encodes both the workflow path and the tag
  ref in the Fulcio SAN), so we keep it and drop `--signer-workflow`.
  Symmetric to klodr/faxdrop-mcp v0.1.9.

## [0.7.8] - 2026-04-18

### Changed

- `.github/workflows/verify-release.yml` — added manual ECDSA P-256 verification
  of the npm registry signature on `<pkg>@<version>:<integrity>` against the
  public keys at `https://registry.npmjs.org/-/npm/v1/keys`. Closes the gap
  introduced in 0.7.7 where the local-tarball install bypassed
  `npm audit signatures` registry-side check (a registry-based install
  would have re-tripped Scorecard's Pinned-Dependencies). Per CodeRabbit
  on PR #33.

## [0.7.7] - 2026-04-18

### Changed

- `.github/workflows/verify-release.yml` — Path 1 `npm install` now downloads
  the tarball explicitly, verifies its SHA-1 against the registry-published
  `dist.shasum`, and installs the local file (instead of `npm install
  <pkg>@<version>`). Fixes Scorecard `Pinned-Dependencies` finding.
  Functionally equivalent install (still `--ignore-scripts`), but every byte
  that hits `node_modules` is hash-verified against registry metadata.
  Symmetric to klodr/faxdrop-mcp v0.1.6.

## [0.7.6] - 2026-04-18

### Changed

- `.github/workflows/verify-release.yml` — `gh attestation verify` now also
  passes `--cert-identity` (in addition to `--signer-workflow` and
  `--source-ref`) to lock the exact Fulcio SAN encoded in the attestation
  certificate, matching what cosign verifies in Path 3. `--signer-workflow`
  alone matches the workflow file but not the ref encoded in the SAN; the
  added flag closes the last latitude.

## [0.7.5] - 2026-04-18

### Added

- **Post-release verification workflow** (`.github/workflows/verify-release.yml`):
  re-exercises the three SECURITY.md verification paths (`npm audit signatures`,
  `gh attestation verify`, `cosign verify-blob-attestation`) on every published
  release. Runs on `workflow_run: completed` of `Release & npm publish` and
  fails fast if provenance, the Sigstore bundle, or the attached release assets
  drift. cosign installed via `sigstore/cosign-installer@v4.1.1` (SHA-pinned).

### Documentation

- `SECURITY.md`: extended the "single-process semantics" entry with an
  explicit "persistent unreadable state" paragraph. On chronic `EACCES`/`EIO`
  on the state file the middleware preserves the prior counter (does not
  overwrite) and falls back to an in-memory cap valid for the current
  process only — i.e. the cross-restart guarantee degrades to "cross-call
  within one session". Mercury's server-side limits remain the load-bearing
  control under that condition.

## [0.7.4] - 2026-04-18

### Fixed

- **Rate-limit state now survives process restarts.** MCP hosts that respawn the
  server per session (Claude Desktop, Claude Code, Cursor with stdio transport)
  used to silently reset the in-memory `callHistory`, defeating the daily caps.
  State is now persisted to `~/.mercury-mcp/ratelimit.json` (mode `0o600`,
  atomic write via `rename`). Override the location with the new
  `MERCURY_MCP_STATE_DIR` env var. Corrupted state files are detected and the
  middleware starts fresh with a logged warning. Tests added: cross-restart
  enforcement, mode `0o600` verification, corrupted-file recovery.

### Documentation

- `SECURITY.md`: new entry under "What this MCP does NOT protect against"
  describing prompt injection through Mercury response data — counterparty-
  controlled fields (`customer.name`, `recipient.note`, invoice memos,
  transaction descriptions) are forwarded verbatim to the LLM. Reminder that
  read-then-write chains require explicit user confirmation.
- `SECURITY.md` + `README.md`: documented `MERCURY_MCP_STATE_DIR` and the
  cross-restart guarantee.

## [0.7.3] - 2026-04-18

### Fixed

- `codeql.yml` + `scorecard.yml`: pinned `github/codeql-action` to the **commit SHA** of v4.35.2 (`95e58e9a…`) instead of the SHA of the annotated tag object (`7fc6561…`). OpenSSF Scorecard's "imposter commit" verification rejected the tag-object SHA with HTTP 400. Same fix on `klodr/faxdrop-mcp`.
- `README.md`: CodeQL badge now points at our explicit Advanced workflow (`actions/workflows/codeql.yml/badge.svg`) instead of the unused GitHub Default Setup URL — badge now shows passing/failing instead of just the wordmark.

## [0.7.2] - 2026-04-18

### Changed

- `codeql.yml` + `scorecard.yml`: bumped `github/codeql-action` from v3 to **v4.35.2** (SHA-pinned `7fc6561…`). v3 EOL is December 2026 and the underlying actions still ran on Node 20, which GitHub deprecates in September 2026; v4 runs on Node 24.
- Tooling consistency with `klodr/faxdrop-mcp`: ESLint v9 flat config with `typescript-eslint` type-aware rules; Prettier + `eslint-config-prettier`; `Lint & Format` CI job gating every PR; TypeScript strict + `noUnusedLocals/noUnusedParameters/noImplicitReturns/noFallthroughCasesInSwitch`; jest `restoreMocks: true` to auto-restore spies between tests. Already on `main` since PRs #25/#26; surfaced in this release for the npm changelog.

## [0.7.1] - 2026-04-18

### Changed

- `SECURITY.md`: switched the `cosign verify-blob-attestation` example to `--bundle index.js.sigstore` (the actual Sigstore bundle file with the Fulcio cert chain + Rekor inclusion proof). The previous `--signature index.js.intoto.jsonl` form could not complete keyless verification on its own. The companion `index.js.intoto.jsonl` asset is documented as the SLSA-format file consumed by tools that scan release assets by extension (Scorecard `Signed-Releases`).
- `SECURITY.md`: softened the "vulnerable versions will trigger Dependabot alerts" line to a conditional "may trigger ... provided Dependabot security updates are enabled" — alerts depend on the consuming repository's configuration.

### Fixed

- `scripts/sandbox-test.mjs`: removed two unused `const` assignments (`recipients`, `trAccs`) flagged by CodeQL alerts #20 / #21. The `await run(...)` calls remain for their smoke-test side effect.

## [0.7.0] - 2026-04-18

### Added

- `test/fuzz.test.ts`: property-based tests using `fast-check`. Covers `redactSensitive` (no leak through any sensitive key at any depth, mixed-case variants exercise the case-folding path) and `MercuryError` (toString / toJSON never expose the response body, sentinel-based property). Recognised by OpenSSF Scorecard's `Fuzzing` check (8/10 → 10/10).
- `release.yml`: now also emits `dist/index.js.intoto.jsonl` (SLSA in-toto attestation extracted from the Sigstore bundle's DSSE envelope, with non-null guard) alongside `dist/index.js.sigstore`. Lifts Scorecard's `Signed-Releases` check from 8/10 to 10/10.
- `CONTINUITY.md`: project continuity plan with a fork-and-continue takeover checklist (Best Practices Silver: `access_continuity`).
- `ASSURANCE_CASE.md`: threat model, trust boundaries, secure-design principles, CWE/OWASP weakness mapping (Best Practices Silver: `assurance_case`).
- `SECURITY.md`: explicit "Security model — what you can and cannot expect" section; "Verifying releases" section with three independent paths (npm CLI provenance, `gh attestation verify`, `cosign verify-blob-attestation`).

### Changed

- `src/middleware.ts`: `SENSITIVE_KEYS` is now exported and `Object.freeze`d so the fuzz tests can reuse the canonical list (no drift) and the array is immutable at runtime.

## [0.6.2] - 2026-04-18

### Changed

- `release.yml`: end-to-end automated release on `git push origin vX.Y.Z`. The workflow now extracts the matching `## [VERSION]` section from `CHANGELOG.md`, creates (or updates) the GitHub Release with those notes, signs `dist/index.js` with Sigstore, attaches the signed bundle, and `npm publish --provenance`. No manual UI step.
- `release.yml`: added a sanity check that the pushed tag matches `package.json`'s `version` — fails fast on mismatched bumps.
- `release.yml`: changelog link in the auto-generated release notes pinned to `/blob/${TAG}/CHANGELOG.md` (was `/blob/main/`) so it stays authoritative for the release it accompanies.
- `release.yml`: GitHub Release creation is idempotent (`view` then `edit` if it exists, `create` otherwise) so re-runs after a later-step failure are not blocked.
- `codeql.yml`: matrix now includes both `javascript-typescript` and `actions` languages. Replaces the deleted auto-generated `codeql-analysis.yml` whose duplicate job name was triggering parallel runs and confusing the required `Code scanning results / CodeQL` status check.

### Added

- README: OpenSSF Best Practices badge ([project 12575](https://www.bestpractices.dev/projects/12575), passing tier).

## [0.6.1] - 2026-04-18

### Fixed

- `release.yml`: replaced the incorrect `@sigstore/cli@1.0.0` install (no such version, no `sign` subcommand) with `actions/attest-build-provenance@v4.1.0`. The v0.6.0 release run failed at the install step, so 0.6.0 was never published to npm — 0.6.1 ships the same code as 0.6.0 plus a working signing pipeline.
- `release.yml`: added a `BUNDLE_PATH` guard before `cp` so a missing attestation output produces a self-explanatory error instead of a generic `cp` failure.

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

[Unreleased]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.8.6...v0.9.0
[0.8.6]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.8.2...v0.8.4
[0.8.2]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.9...v0.8.0
[0.7.9]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.8...v0.7.9
[0.7.8]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.7...v0.7.8
[0.7.7]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.2.0...v0.6.0
[0.2.0]: https://github.com/klodr/mercury-invoicing-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/klodr/mercury-invoicing-mcp/releases/tag/v0.1.0
