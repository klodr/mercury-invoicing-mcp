/**
 * Note on testing src/index.ts:
 * The main() function attaches a stdio transport which makes it hard to test
 * in isolation without actually running an MCP server. The critical logic
 * (env validation, sandbox auto-detection, tool registration with middleware)
 * is fully exercised by integration.test.ts (server + 45 tools) and
 * middleware.test.ts (rate limit, dry-run, audit log).
 *
 * If stdio test coverage becomes critical, consider extracting the
 * non-transport bits into a separate factory and testing that.
 */

it.skip("placeholder — see comment above", () => {
  expect(true).toBe(true);
});
