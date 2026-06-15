/**
 * Seed the datastore with demo sources. Idempotent-ish: re-running adds fresh source ids.
 * Usage: npm run seed-sources
 */

import { getDb } from "../lib/db/index.ts";
import { createSource } from "../lib/sources/create-source.ts";
import { SEED_SOURCES } from "../lib/sources/seed-data.ts";

const db = await getDb();
const existing = await db.listSources();
if (existing.length > 0) {
  console.log(`Already have ${existing.length} source(s):`);
  for (const s of existing) console.log(`  • ${s.name} → ${s.walletAddress}`);
  console.log("\nDelete data/keryx.sqlite to reseed from scratch.");
  process.exit(0);
}

console.log("Seeding sources…\n");
for (const input of SEED_SOURCES) {
  const s = await createSource(db, input);
  const authors =
    s.authors.length > 1
      ? ` (${s.authors.map((a) => `${a.name} ${a.splitWeight * 100}%`).join(", ")})`
      : "";
  console.log(`  ✓ ${s.name}  $${s.fetchPrice}/fetch  → ${s.walletAddress}${authors}`);
}
console.log(`\nSeeded ${SEED_SOURCES.length} sources. Run: npm run ask -- "your question"`);
