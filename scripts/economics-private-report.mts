import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { writePrivateEconomicsReport } from "../lib/economics/private-report";

async function main() {
  const { values } = parseArgs({ strict: true, allowPositionals: false,
    options: { help: { type: "boolean" }, directory: { type: "string" } } });
  if (values.help) {
    console.log("Usage: npm run economics:private-report -- --directory ABSOLUTE_NEW_DIRECTORY\nLoad the operator environment explicitly. Linux only; the parent must already be owner-only. Writes economics.json privately without printing figures or overwriting files. Estimates remain unreconciled; invoices, fixed costs and realized profit remain unknown. No signing or payment.");
    return;
  }
  if (!values.directory) throw new Error();
  await writePrivateEconomicsReport(values.directory, async () => {
    const { config, hasSupabase } = await import("../lib/config");
    if (config.networkId !== "eip155:5042002") throw new Error();
    // Never call init(): a report must not migrate data or rewrite paid-content caches.
    const db = hasSupabase()
      ? new (await import("../lib/db/supabase-adapter")).SupabaseAdapter()
      : new (await import("../lib/db/sqlite-adapter")).SqliteAdapter(resolve("data/keryx.sqlite"), { readOnly: true });
    try { return await db.economics(); }
    finally { (db as { close?: () => void }).close?.(); }
  });
  console.log("Private economics report saved. No invoice reconciliation or realized profit asserted.");
}
main().catch(() => { console.error("Private economics export unavailable. Check the protected destination and operator configuration. Retain any existing files; private details omitted."); process.exitCode = 1; });
