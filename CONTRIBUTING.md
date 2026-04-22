# Contributing

Issues and PRs welcome. Please open an issue first for substantial changes.

## Before submitting a PR

1. `npm install` then `npm test` (must stay green with ≥98% statement coverage)
2. `npm run build` (must succeed; the published tarball is only `dist/index.js` + `package.json` + `README.md` + `LICENSE`)
3. Update `CHANGELOG.md` under `[Unreleased]`
4. If you add or rename a tool, update the `Tools` section in the README and the `defineTool(server, ...)` call in `src/tools/`
5. New write tools must be registered in `TOOL_BUCKET` + `DEFAULT_BUCKET_LIMITS` (`src/middleware.ts`) so they are rate-limited

## Developer Certificate of Origin

Every commit carries a `Signed-off-by:` trailer — adding it (automatic with `git commit -s` or our prepare-commit-msg hook) certifies the [DCO 1.1](https://developercertificate.org/).

## Releases (maintainers only)

Do not edit `version` by hand — run `npm version patch|minor|major`. The lifecycle hook calls `scripts/sync-version.mjs` to propagate the bump into `server.json` and `src/server.ts`. Editing `package.json` directly will leave those two files out of sync.
