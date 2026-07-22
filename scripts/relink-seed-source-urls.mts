/**
 * Repoints seed sources whose `url` is an example.com placeholder at their real public home —
 * the /creator/<id> page — so the registry's external link lands on actual content.
 *
 * Only the cache row's `url` changes. The on-chain record is untouched: the registry id was
 * derived from the URL the source was registered under, and both the indexer and the parity
 * watchdog resolve rows by the stored `onchain_id`, never by re-hashing the row's url.
 *
 * Idempotent — after one run no example.com urls remain, so a re-run is a no-op.
 * Usage: node --import tsx --no-warnings --env-file-if-exists=.env.local scripts/relink-seed-source-urls.mts
 */

import { getDb } from "../lib/db/index.ts";

const base = process.env.BASE_URL || "https://keryx.cc";
const db = await getDb();

const placeholders = (await db.listAllSources()).filter((s) => {
  try {
    return new URL(s.url).hostname === "example.com";
  } catch {
    return false;
  }
});

if (placeholders.length === 0) {
  console.log("No sources carry an example.com placeholder url. Nothing to do.");
  process.exit(0);
}

for (const s of placeholders) {
  const home = `${base}/creator/${s.id}`;
  await db.upsertSource({ ...s, url: home });
  console.log(`  ✓ ${s.name}  ${s.url} → ${home}`);
}
console.log(`\nRelinked ${placeholders.length} source(s).`);
