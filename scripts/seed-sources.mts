/**
 * Seed the datastore with demo sources. Idempotent by name: re-running adds only the seed
 * sources that aren't present yet (existing creators, their wallets, and earnings are untouched).
 * Usage: npm run seed-sources
 */

import { getDb } from "../lib/db/index.ts";
import { createSource } from "../lib/sources/create-source.ts";
import { SEED_SOURCES } from "../lib/sources/seed-data.ts";

const db = await getDb();
const existing = await db.listSources();
const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));
const toSeed = SEED_SOURCES.filter((s) => !existingNames.has(s.name.toLowerCase()));

if (toSeed.length === 0) {
  console.log(`All ${SEED_SOURCES.length} seed sources already present (${existing.length} total). Nothing to add.`);
  process.exit(0);
}

console.log(`Seeding ${toSeed.length} new source(s) (${existing.length} already present)…\n`);
for (const input of toSeed) {
  const s = await createSource(db, input);
  const authors =
    s.authors.length > 1
      ? ` (${s.authors.map((a) => `${a.name} ${a.splitWeight * 100}%`).join(", ")})`
      : "";
  console.log(`  ✓ ${s.name}  $${s.fetchPrice}/fetch  → ${s.walletAddress}${authors}`);
}
console.log(`\nSeeded ${toSeed.length} new source(s). Run: npm run ask -- "your question"`);
