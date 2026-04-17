// Sandbox test runner — exercises all Mercury MCP tools (excluding Plan Plus features)
// against the real Mercury sandbox API.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MercuryClient } from "../src/client.ts";
import { registerAllTools } from "../src/tools/index.ts";
import { wrapToolHandler } from "../src/middleware.ts";

const TOKEN = process.env.MERCURY_API_KEY;
if (!TOKEN) {
  console.error("MERCURY_API_KEY required");
  process.exit(1);
}

// Force sandbox base URL (skip auto-detect for clarity)
const mercury = new MercuryClient({ apiKey: TOKEN, baseUrl: "https://api-sandbox.mercury.com/api/v1" });
const server = new McpServer({ name: "test", version: "0.0.0" });

// Apply same middleware patch
const originalTool = server.tool.bind(server);
server.tool = (...args) => {
  const lastIdx = args.length - 1;
  if (typeof args[lastIdx] === "function" && typeof args[0] === "string") {
    args[lastIdx] = wrapToolHandler(args[0], args[lastIdx]);
  }
  return originalTool(...args);
};

registerAllTools(server, mercury);

const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "tester", version: "0.0.0" });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const results = [];
async function run(label, name, args = {}) {
  process.stdout.write(`▶ ${label.padEnd(45)} `);
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content[0].text;
    if (res.isError) {
      // Extract error message
      const isAccessError = text.includes("access to this feature") || text.includes("subscriptions");
      const is403 = text.includes("403");
      const is400 = text.includes("400");
      const is404 = text.includes("404");
      const tag = isAccessError ? "🔒 PLAN PLUS" : is403 ? "❌ 403" : is400 ? "⚠️  400" : is404 ? "⚠️  404" : "❌ ERR";
      console.log(`${tag}`);
      results.push({ tool: label, status: "error", detail: text.slice(0, 120) });
      return null;
    }
    console.log("✅");
    results.push({ tool: label, status: "ok" });
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch (err) {
    console.log(`💥 EXCEPTION: ${err.message}`);
    results.push({ tool: label, status: "exception", detail: err.message });
    return null;
  }
}

console.log("\n=== READS — BANKING ===");
const accounts = await run("mercury_list_accounts", "mercury_list_accounts");
const acc = accounts?.accounts?.[0];
const accId = acc?.id;
if (accId) {
  await run("mercury_get_account", "mercury_get_account", { accountId: accId });
  await run("mercury_list_cards", "mercury_list_cards", { accountId: accId });
  await run("mercury_list_transactions (limit 3)", "mercury_list_transactions", { accountId: accId, limit: 3 });
  await run("mercury_list_statements", "mercury_list_statements", { accountId: accId });
}
await run("mercury_list_categories", "mercury_list_categories");
await run("mercury_get_organization", "mercury_get_organization");
const recipients = await run("mercury_list_recipients", "mercury_list_recipients");
await run("mercury_get_treasury", "mercury_get_treasury");
const trAccs = await run("mercury_list_treasury_transactions (existing tr ID)", "mercury_list_treasury_transactions", { accountId: "00000000-0000-0000-0000-000000000000" });

console.log("\n=== WRITES — BANKING ===");
const newRec = await run("mercury_add_recipient (TEST)", "mercury_add_recipient", {
  name: "TEST_DELETE_ME_" + Date.now(),
  emails: ["test@test.com"],
  paymentMethod: "domesticAch",
});
const recId = newRec?.id;
// Note: update_recipient + list_send_money_requests removed (Mercury doesn't expose them in API)

console.log("\n=== WEBHOOKS ===");
const whList = await run("mercury_list_webhooks", "mercury_list_webhooks");
const newWh = await run("mercury_create_webhook (TEST)", "mercury_create_webhook", {
  url: "https://example.com/webhook-test-" + Date.now(),
  events: ["transaction.created"],
});
const whId = newWh?.id;
if (whId) {
  await run("mercury_get_webhook", "mercury_get_webhook", { webhookId: whId });
  // Note: update_webhook removed (Mercury 405 on PATCH and PUT)
  await run("mercury_delete_webhook", "mercury_delete_webhook", { webhookId: whId });
}

// Note: COA Templates + Journal Entries removed (Mercury does not expose those API endpoints publicly)

console.log("\n=== AR (PLAN PLUS — read works, writes need Plus) ===");
await run("mercury_list_invoices", "mercury_list_invoices");
await run("mercury_list_customers", "mercury_list_customers");

console.log("\n\n========== SUMMARY ==========");
const ok = results.filter((r) => r.status === "ok").length;
const planPlus = results.filter((r) => r.detail?.includes("subscriptions") || r.detail?.includes("access to this feature")).length;
const errors = results.filter((r) => r.status === "error" && !r.detail?.includes("subscriptions") && !r.detail?.includes("access to this feature")).length;
const exc = results.filter((r) => r.status === "exception").length;
console.log(`✅ OK:           ${ok}`);
console.log(`🔒 Plan Plus:    ${planPlus}  (expected — sandbox doesn't have Plus)`);
console.log(`❌ Other errors: ${errors}`);
console.log(`💥 Exceptions:   ${exc}`);

if (errors > 0 || exc > 0) {
  console.log("\nFailures:");
  for (const r of results.filter((x) => x.status !== "ok" && !x.detail?.includes("subscriptions") && !x.detail?.includes("access to this feature"))) {
    console.log(`  - ${r.tool}: ${r.detail}`);
  }
}

await client.close();
process.exit(0);
