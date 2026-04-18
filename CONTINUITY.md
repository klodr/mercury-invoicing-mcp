# Project continuity plan

`mercury-invoicing-mcp` is maintained by a single individual (`@klodr`).
This document explains how the project can continue with minimal
interruption (≤1 week) if I become unavailable.

## Built-in resilience (FLOSS guarantees)

- **Source code**: public on GitHub under [MIT](./LICENSE). Anyone can fork
  and continue development, including bug fixes and feature work.
- **Release artifacts**: every published version is signed with Sigstore
  (`dist/index.js.sigstore`) and ships an SLSA in-toto attestation
  (`dist/index.js.intoto.jsonl`), plus npm provenance. Downstream users
  can verify the chain of custody of any past release even if the
  original repo or npm scope becomes unmaintained.
- **Build & release pipeline** is fully automated in
  [`.github/workflows/release.yml`](./.github/workflows/release.yml) and
  documented in [`CHANGELOG.md`](./CHANGELOG.md). A fork can reproduce
  releases by configuring `NPM_TOKEN` and pushing a tag.
- **No proprietary infrastructure**: no private dashboards, no
  unmanageable accounts. All third-party integrations (CodeQL, Scorecard,
  CodeRabbit, Socket Security, Codecov, Snyk, Dependabot) are free and
  re-attachable to a fork.

## Within 1 week of confirmed unavailability

If the maintainer is confirmed unable to continue, anyone can:

1. Fork [`klodr/mercury-invoicing-mcp`](https://github.com/klodr/mercury-invoicing-mcp).
2. Continue issue triage, PR review, and merges in the fork.
3. Publish releases under their own npm scope (e.g.
   `@yourname/mercury-invoicing-mcp`) following the documented release
   flow — this typically takes minutes once `NPM_TOKEN` is set.
4. Update downstream MCP client configs to point at the fork's package.

There is no organisational lock-in: every secret and every external
service can be re-provisioned by the new maintainer, typically within
hours, depending on third-party account approval and token issuance times.

## Ongoing improvements

- Adding a second maintainer is welcomed. Contributors with multiple
  merged PRs may propose adding their handle to
  [`.github/CODEOWNERS`](./.github/CODEOWNERS).
- The maintainer's contact is on the
  [GitHub profile](https://github.com/klodr) for emergency hand-off
  coordination.
