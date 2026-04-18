# Security Policy

## Security model — what you can and cannot expect

This section documents the project's **security requirements**: guarantees the
maintainer commits to, and limits that callers must account for.

### What this MCP provides

- **Authenticated transport**: every Mercury API call goes over HTTPS with the
  user-supplied bearer token. No fallback to HTTP, no token in URL parameters.
- **Input validation**: all tool inputs are validated by Zod schemas before
  reaching `MercuryClient`. Path-injected IDs require `.uuid()` and are
  URL-encoded per segment (defense in depth against prompt injection).
- **Sandbox isolation**: tokens prefixed `secret-token:mercury_sandbox_` are
  auto-routed to `api-sandbox.mercury.com`. The match is a strict prefix, so a
  production token containing the string `sandbox` is not accidentally routed.
- **No secret leakage**: `MercuryError.toString()` and `toJSON()` never include
  the raw API response body. The audit log redacts `accountNumber`,
  `routingNumber`, `apiKey`, `authorization`, `password`, `token`, `secret`,
  `ssn` at any depth (see `redactSensitive` in `src/middleware.ts`, covered by
  property-based tests in `test/fuzz.test.ts`).
- **Supply-chain integrity**: every release artifact is signed with Sigstore
  (`*.sigstore`) and ships an SLSA in-toto attestation (`*.intoto.jsonl`).
  npm publishes carry [provenance](https://docs.npmjs.com/generating-provenance-statements).
  All GitHub Actions in `.github/workflows/` are pinned by full commit SHA.
- **Least-privilege CI**: the release workflow is split into a read-only build
  job and a release-only publish job that holds `NPM_TOKEN`.
- **Defense against runaway agents**: rate-limiting middleware caps write
  operations per category (configurable via `MERCURY_MCP_RATE_LIMIT_*`), and a
  dry-run mode (`MERCURY_MCP_DRY_RUN=true`) lets you exercise prompts without
  hitting Mercury.
- **Optional audit trail**: `MERCURY_MCP_AUDIT_LOG=/abs/path/audit.log` writes
  an append-only JSON Lines record (file mode `0o600`, sensitive fields
  redacted) of every write call.

### What this MCP does NOT protect against

- **Compromise of the host environment**: if your shell, terminal, or MCP
  client is compromised, your `MERCURY_API_KEY` can be stolen by the attacker.
  This MCP cannot detect or prevent that.
- **Malicious LLM prompts (prompt injection)**: an LLM that exposes write
  tools to untrusted content can be tricked into calling those tools with
  attacker-chosen arguments. Mitigations: scope your Mercury token tightly,
  enable `MERCURY_MCP_DRY_RUN`, require human-in-the-loop confirmation for
  any write tool, or use a read-only token when serving untrusted channels.
- **Mercury account-level security**: 2FA, IP allowlists, fraud detection,
  and account recovery are Mercury's responsibility, not this MCP's.
- **Network-level attackers** beyond what TLS provides: this MCP relies on
  Node's built-in `fetch` and the system trust store. It does not pin
  certificates.
- **Logging downstream of this MCP**: the audit log redacts sensitive fields,
  but if the MCP client (Claude Desktop, Cursor, etc.) records tool inputs
  to its own log, that is outside this project's control.
- **Cryptographic primitives**: this project does not implement crypto. It
  uses `crypto.randomUUID()` from Node's standard library for idempotency
  keys; everything else relies on TLS and Sigstore.

## Verifying releases

Every published release of `mercury-invoicing-mcp` is cryptographically
signed. There is **no private signing key** to manage: signing is keyless
via [Sigstore](https://www.sigstore.dev/) using GitHub's OIDC identity
through the [`actions/attest-build-provenance`](https://github.com/actions/attest-build-provenance)
workflow. The trust chain is: GitHub OIDC → Fulcio (short-lived cert) →
Rekor (transparency log).

Three independent ways to verify:

### 1. npm package — npm CLI

```bash
# Verify the published tarball matches the GitHub release that built it
npm view mercury-invoicing-mcp@<version> --json | jq .dist.attestations
npm install --foreground-scripts --ignore-scripts mercury-invoicing-mcp@<version>
# or, for the strict provenance check:
npm audit signatures
```

### 2. GitHub Release artifacts — `gh attestation`

```bash
# Verify the dist/index.js artifact attached to the release
gh release download v<version> --repo klodr/mercury-invoicing-mcp --pattern 'index.js*'
gh attestation verify index.js --repo klodr/mercury-invoicing-mcp
```

### 3. Sigstore bundle (with embedded SLSA in-toto attestation) — `cosign`

The `index.js.sigstore` bundle is what `actions/attest-build-provenance`
emits: a Sigstore-format bundle containing the DSSE-wrapped SLSA in-toto
attestation plus the Fulcio certificate and the Rekor inclusion proof.
That's the file [cosign](https://docs.sigstore.dev/cosign/installation/)
wants for keyless verification:

```bash
cosign verify-blob-attestation \
  --bundle index.js.sigstore \
  --certificate-identity-regexp '^https://github\.com/klodr/mercury-invoicing-mcp/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  index.js
```

The companion `index.js.intoto.jsonl` shipped in the same release is the
DSSE envelope on its own, exposed for tools (like OpenSSF Scorecard's
`Signed-Releases` check) that scan release assets by file extension.

Any verification failure means the artifact was not built by the
official release pipeline — do not install it.

## Reporting a Vulnerability

If you discover a security vulnerability in `mercury-invoicing-mcp`, please report it **privately** so we can address it before any disclosure.

### Preferred channel: Private vulnerability reporting

Use GitHub's [Private vulnerability reporting](https://github.com/klodr/mercury-invoicing-mcp/security/advisories/new) feature. Maintainers will receive your report directly.

### Alternative

If for any reason you cannot use GitHub's private reporting, open an issue with **only** the message "private security report — please contact me" and a maintainer will reach out.

**Do not** open a public issue with vulnerability details before a fix is released.

## What to include

- A clear description of the issue
- Steps to reproduce (proof of concept if possible)
- Affected versions
- Suggested mitigation if you have one

## Response targets

- **Acknowledgement**: within 72 hours
- **Initial assessment**: within 7 days
- **Fix or mitigation**: depends on severity, typically within 30 days for high/critical issues

## Scope

This policy covers vulnerabilities in this repository's code (the MCP server itself). Issues in upstream dependencies should be reported to those projects directly; we will track the CVE and update our pinned versions.

## Security best practices when using this MCP

- **Never** commit your `MERCURY_API_KEY` to version control. Use environment variables or your MCP client's secret management.
- Use **scoped tokens** with the minimum permissions you need.
- Be aware that exposing write tools (send_money, create_invoice, etc.) to an LLM that processes untrusted content opens a prompt injection vector. Use read-only tokens or human-in-the-loop confirmation for write operations.
- Keep this package updated; vulnerable versions will trigger Dependabot alerts on your projects.

Thanks for helping keep `mercury-invoicing-mcp` and its users safe.
