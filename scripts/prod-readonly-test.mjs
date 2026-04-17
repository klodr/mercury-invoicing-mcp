// Production read-only test runner — exhaustive read coverage
// Uses real prod data: list_X → take first ID → get_X(id)

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

const TOKEN = process.env.MERCURY_API_KEY;
if (!TOKEN) {
  console.error("MERCURY_API_KEY required");
  process.exit(1);
}

const server = createServer({ apiKey: TOKEN, log: () => {} });
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "tester", version: "0.0.0" });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const results = [];
async function run(label, name, args = {}) {
  process.stdout.write(`▶ ${label.padEnd(50)} `);
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content[0].text;
    if (res.isError) {
      const tag = text.includes("403") ? "🔒 403" : text.includes("404") ? "⚠️  404" : "❌ ERR";
      console.log(`${tag} — ${text.slice(0, 80)}`);
      results.push({ tool: label, status: "error", detail: text });
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
    console.log(`💥 ${err.message}`);
    results.push({ tool: label, status: "exception", detail: err.message });
    return null;
  }
}

console.log("\n=== ACCOUNTS ===");
const accs = await run("mercury_list_accounts", "mercury_list_accounts");
const acc = accs?.accounts?.[0];
const accId = acc?.id;
console.log(`   → using accountId = ${accId}`);
if (accId) {
  await run("mercury_get_account", "mercury_get_account", { accountId: accId });
  await run("mercury_list_cards", "mercury_list_cards", { accountId: accId });
  await run("mercury_list_statements", "mercury_list_statements", { accountId: accId });
}
await run("mercury_list_categories", "mercury_list_categories");
await run("mercury_get_organization", "mercury_get_organization");

console.log("\n=== TRANSACTIONS ===");
const txs = await run("mercury_list_transactions (limit 3)", "mercury_list_transactions", {
  accountId: accId,
  limit: 3,
});
const tx = txs?.transactions?.[0];
const txId = tx?.id;
console.log(`   → using transactionId = ${txId}`);
if (accId && txId) {
  await run("mercury_get_transaction", "mercury_get_transaction", {
    accountId: accId,
    transactionId: txId,
  });
}

console.log("\n=== RECIPIENTS ===");
await run("mercury_list_recipients", "mercury_list_recipients");

console.log("\n=== TREASURY ===");
const treasury = await run("mercury_get_treasury", "mercury_get_treasury");
const trId = treasury?.accounts?.[0]?.id;
if (trId) {
  console.log(`   → using treasury accountId = ${trId}`);
  await run("mercury_list_treasury_transactions", "mercury_list_treasury_transactions", {
    accountId: trId,
  });
  await run("mercury_list_treasury_statements", "mercury_list_treasury_statements", {
    accountId: trId,
  });
} else {
  console.log("   → no treasury accounts (skipping treasury tx/statements)");
}

console.log("\n=== WEBHOOKS ===");
const whs = await run("mercury_list_webhooks", "mercury_list_webhooks");
const whId = whs?.webhooks?.[0]?.id ?? whs?.[0]?.id;
if (whId) {
  console.log(`   → using webhookId = ${whId}`);
  await run("mercury_get_webhook", "mercury_get_webhook", { webhookId: whId });
} else {
  console.log("   → no webhooks configured (skipping get_webhook)");
}

console.log("\n=== AR INVOICING ===");
const invs = await run("mercury_list_invoices", "mercury_list_invoices");
const inv = invs?.invoices?.[0];
const invId = inv?.id;
if (invId) {
  console.log(`   → using invoiceId = ${invId}`);
  await run("mercury_get_invoice", "mercury_get_invoice", { invoiceId: invId });
  await run("mercury_list_invoice_attachments", "mercury_list_invoice_attachments", {
    invoiceId: invId,
  });
}

console.log("\n=== AR CUSTOMERS ===");
const custs = await run("mercury_list_customers", "mercury_list_customers");
const cust = custs?.customers?.[0];
const custId = cust?.id;
if (custId) {
  console.log(`   → using customerId = ${custId}`);
  await run("mercury_get_customer", "mercury_get_customer", { customerId: custId });
}

console.log("\n========== SUMMARY ==========");
const ok = results.filter((r) => r.status === "ok").length;
const errs = results.filter((r) => r.status !== "ok").length;
console.log(`✅ OK:           ${ok}`);
console.log(`❌ Errors:       ${errs}`);
if (errs) {
  console.log("\nFailures:");
  for (const r of results.filter((x) => x.status !== "ok")) {
    console.log(`  - ${r.tool}: ${r.detail?.slice(0, 150)}`);
  }
}

await client.close();
process.exit(0);
