import { readRuntimeStorageDeployment } from "../lib/db/runtime-storage-config.ts";
import { getDb } from "../lib/db/index.ts";
import { APPROVED_PUBLIC_REFERENCES } from "../lib/public-references/approved-catalog.ts";
import { importPublicReferenceCatalog } from "../lib/public-references/import-catalog.ts";

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== "--apply")) throw new Error("Use --apply to import the approved public reference batch");
if (!args.includes("--apply")) {
  console.log(`Approved free public references: ${APPROVED_PUBLIC_REFERENCES.map((reference) => reference.name).join(", ")}. Use --apply to fetch and import.`);
} else {
  if (readRuntimeStorageDeployment().backend.kind !== "sqlite") throw new Error("Public reference onboarding requires SQLite");
  const results = await importPublicReferenceCatalog(await getDb());
  for (const result of results) console.log(`${result.name}: ${result.ok ? `${result.items} public feed items` : "import failed"}`);
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}
