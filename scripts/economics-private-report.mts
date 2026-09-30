import { parseArgs } from "node:util";
import { readRuntimeStorageDeployment } from "../lib/db/runtime-storage-config";
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
    const deployment = readRuntimeStorageDeployment();
    // Read-only admission never initializes/migrates tables or content caches.
    const db = deployment.backend.kind === "supabase"
      ? new (await import("../lib/db/supabase-adapter")).SupabaseAdapter(deployment.identity)
      : new (await import("../lib/db/sqlite-adapter")).SqliteAdapter(deployment.backend.databasePath,
        { readOnly: true, expectedIdentity: deployment.identity });
    try { return await db.economics(); }
    finally { (db as { close?: () => void }).close?.(); }
  });
  console.log("Private economics report saved. No invoice reconciliation or realized profit asserted.");
}
main().catch(() => { console.error("Private economics export unavailable. Check the protected destination and operator configuration. Retain any existing files; private details omitted."); process.exitCode = 1; });
