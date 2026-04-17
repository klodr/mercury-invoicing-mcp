# Security Policy

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
