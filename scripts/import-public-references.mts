import { hasSupabase } from "../lib/config.ts";
import { getDb } from "../lib/db/index.ts";
import { APPROVED_PUBLIC_REFERENCES } from "../lib/public-references/approved-catalog.ts";
import { importPublicReferenceCatalog } from "../lib/public-references/import-catalog.ts";

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== "--apply")) throw new Error("Use --apply to import the approved public reference batch");
if (!args.includes("--apply")) {
  console.log(`Approved free public references: ${APPROVED_PUBLIC_REFERENCES.map((reference) => reference.name).join(", ")}. Use --apply to fetch and import.`);
} else {
  if (hasSupabase()) throw new Error("Public reference onboarding requires SQLite");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  let db: Awaited<ReturnType<typeof getDb>> | undefined;
  try {
    db = await getDb();
    const results = await importPublicReferenceCatalog(db, undefined, {
      signal: controller.signal,
      onProgress(progress) {
        if (progress.phase === "started") console.log(`${progress.name}: importing public feed (${progress.index}/${progress.total})`);
        else {
          const result = progress.result;
          console.log(`${result.name}: ${result.ok ? `${result.items} public feed items` : "import failed"}`);
          if (result.code) console.log(`${result.name}: public import status ${result.code}`);
        }
      },
    });
    if (results.length !== APPROVED_PUBLIC_REFERENCES.length) console.log(`Catalog import stopped after ${results.length}/${APPROVED_PUBLIC_REFERENCES.length} publishers; remaining publishers were not attempted.`);
    if (results.length !== APPROVED_PUBLIC_REFERENCES.length || results.some((result) => !result.ok)) process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    if (db && "close" in db && typeof db.close === "function") db.close();
  }
}
