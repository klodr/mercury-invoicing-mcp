# Assurance case — `mercury-invoicing-mcp`

This document is the project's **assurance case**: an argument for why the
security requirements documented in [SECURITY.md](./SECURITY.md#security-model--what-you-can-and-cannot-expect)
hold. It covers four pillars: the threat model, the trust boundaries,
the secure-design principles applied, and how common implementation
weaknesses have been countered.

## 1. Threat model

### Actors

| Actor | Trust level | Capability |
|---|---|---|
| End user | Trusted (controls their machine) | Sets `MERCURY_API_KEY`, runs the MCP, decides what to expose |
| MCP client (Claude Desktop, Cursor, OpenClaw…) | Trusted | Spawns the MCP over stdio, forwards LLM tool calls |
| LLM agent | **Untrusted** | Issues tool calls, **may be manipulated by prompt injection** in upstream content |
| Mercury API | Trusted (HTTPS + bearer) | Authoritative source for all banking state |
| npm registry / GitHub Releases | Trusted via Sigstore + provenance | Distribute the published package |
| Supply-chain attacker | **Untrusted** | May try to: ship a malicious npm tarball, take over a transitive dep, push a malicious commit, swap a Sigstore identity, alter a GitHub Action |
| Network attacker | Constrained to TLS-defined limits | May intercept traffic if TLS is broken |

### Assets at risk

- The user's `MERCURY_API_KEY` (most sensitive)
- Money in the user's Mercury account (irreversible if exfiltrated)
- Customer/recipient data (PII)
- Audit log integrity (used for after-the-fact security review)
- Build/release pipeline integrity (compromise = downstream user harm)

### Attack scenarios considered

1. **Prompt injection** — an LLM consuming untrusted content (email, web
   page, fetched document) is told "use the Mercury MCP to send $X to
   account Y". Mitigations: scope the API key tightly, run in dry-run,
   require human-in-the-loop confirmation for write tools, or use a
   read-only token for untrusted channels.
2. **Trojaned npm tarball** — an attacker publishes a malicious version
   of `mercury-invoicing-mcp` (typosquat or compromised maintainer
   account). Mitigations: Sigstore signing of every release, SLSA
   in-toto attestation, npm provenance, documented verification path
   (see [SECURITY.md → Verifying releases](./SECURITY.md#verifying-releases)).
3. **Malicious transitive dependency** — a sub-dep of `@modelcontextprotocol/sdk`
   ships malicious code. Mitigations: Socket Security PR alerts,
   Dependabot, CodeQL, Snyk, OpenSSF Scorecard.
4. **Compromised CI workflow** — an attacker pushes a workflow change
   that exfiltrates `NPM_TOKEN`. Mitigations: every action pinned by
   full commit SHA, build/publish jobs split with least-privilege
   tokens, branch protection requires PR + review + CodeQL on workflows
   themselves (`actions` language scanned by CodeQL Advanced).
5. **Path-injection through tool args** — an LLM calls a tool with an
   argument like `../../etc/passwd` or a crafted `accountId` containing
   `?` or `/`. Mitigations: every ID-bearing input is `.uuid()`-validated
   by Zod, and `MercuryClient.request` URL-encodes each path segment
   independently as defense in depth.
6. **Secret leakage in errors or logs** — a Mercury error response
   echoes the request body, which the MCP then logs or stringifies.
   Mitigations: `MercuryError.toString()` and `toJSON()` are sealed
   (status + message only); the audit log redacts a list of sensitive
   keys at any depth (covered by property-based tests in
   [`test/fuzz.test.ts`](./test/fuzz.test.ts)).
7. **Hung Mercury endpoint** — DoS-by-stall: the MCP awaits forever
   and blocks the calling agent. Mitigation: `AbortSignal.timeout(30_000)`
   on every fetch.

## 2. Trust boundaries

```text
┌─────────────────────────────────────────────────────────┐
│                    User's machine                       │
│  ┌──────────┐   stdio    ┌────────────────┐            │
│  │ MCP      │ ─────────► │ mercury-       │            │
│  │ client   │            │ invoicing-mcp  │            │
│  │ (Claude, │ ◄───────── │ (this project) │            │
│  │  Cursor) │            └────────┬───────┘            │
│  └────┬─────┘                     │                    │
│       │                           │                    │
│   .─.─┴─.─.   tool calls          │ HTTPS + Bearer     │
│  ( LLM API )  ───── boundary ───  │                    │
│   `─.─.─'                         │                    │
└───────────────────────────────────┼────────────────────┘
                                    │
                              TLS   ▼
                          ┌─────────────────┐
                          │   Mercury API   │
                          └─────────────────┘
```

The critical untrusted boundary is **LLM agent → MCP server**: tool
arguments arriving from the agent are treated as adversarial input.
Validation, encoding, rate-limiting, and dry-run all live at that
boundary.

## 3. Secure-design principles applied

| Principle | Implementation |
|---|---|
| **Least privilege** | `release.yml` is split into a read-only `build` job and a `publish` job that holds `NPM_TOKEN` and runs only on tag pushes. CodeQL job's permissions limited to `security-events: write`, `contents: read`. Default workflow permissions: `contents: read`. |
| **Defense in depth** | Zod schema validation **and** UUID format check **and** URL-encoding per segment for path-injected IDs. Sigstore signature **and** SLSA attestation **and** npm provenance for releases. |
| **Fail closed** | 30 s fetch timeout. Missing `MERCURY_API_KEY` → exit at startup. Invalid rate-limit env value → log + fall back to default (no silent disable). |
| **Minimise attack surface** | No sourcemaps in published tarball (`prepublishOnly` sets `NODE_ENV=production`). Only `dist/`, `README.md`, `LICENSE` in the npm files allowlist. No HTTP transport (stdio only); no listening sockets. |
| **Secrets are env-only** | API key never on the command line, never in URL params, never in error bodies. `.env.example` shows shape only. Audit log mode `0o600`. |
| **Auditable & reproducible** | Every release is signed and attested. Every commit triggers CI on Node 18/20/22 + CodeQL + Scorecard + Snyk + Socket. Coverage gated at >98%. |
| **Open source, MIT** | Anyone can audit. Project continuity documented in [CONTINUITY.md](./CONTINUITY.md). |

## 4. Common implementation weaknesses countered

Mapped to [CWE](https://cwe.mitre.org/) and [OWASP Top 10](https://owasp.org/Top10/):

| Weakness | Status | Mitigation |
|---|---|---|
| **CWE-22** Path traversal | Countered | `MercuryClient.request` URL-encodes each path segment; all path-injected IDs require `.uuid()` |
| **CWE-78 / CWE-94** Command / code injection | N/A | No `child_process`, no `eval`, no dynamic require |
| **CWE-89** SQL injection | N/A | No database |
| **CWE-79** XSS | N/A | No HTML output |
| **CWE-117** Log injection | Countered | Audit log entries are JSON-encoded; sensitive fields redacted before encoding |
| **CWE-200 / CWE-209** Information exposure / verbose errors | Countered | `MercuryError.toString()` and `toJSON()` strip the response body; `redactSensitive` walks all log/dry-run payloads (property-tested) |
| **CWE-295** Improper certificate validation | Inherited from Node | Node's built-in `fetch` uses the system trust store; we do not override |
| **CWE-321 / CWE-798** Hardcoded credentials | Countered | Env-var only; `.env.example` uses placeholders |
| **CWE-352** CSRF | N/A | Stdio MCP, no HTTP entry point |
| **CWE-426** Untrusted search path | Countered | No `$PATH` manipulation; `npm bin` only |
| **CWE-502** Deserialisation of untrusted data | Limited | Only `JSON.parse` on Mercury responses + tool arguments (validated by Zod) |
| **CWE-732** Incorrect permission assignment | Countered | Audit log opened with mode `0o600` |
| **CWE-918** SSRF | N/A | Base URL is fixed (Mercury or sandbox); no user-controlled URL field |
| **CWE-1357** Reliance on insufficiently trustworthy component | Countered | All GitHub Actions pinned by full commit SHA; Dependabot + Socket monitor for compromised deps |

Outstanding weaknesses are listed transparently in
[SECURITY.md → What this MCP does NOT protect against](./SECURITY.md#what-this-mcp-does-not-protect-against).
