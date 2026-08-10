/**
 * migrate-content-to-ipfs.mts — one-time migration of plaintext content to encrypted storage.
 *
 * For each source_item that has plaintext content but no ipfs_cid:
 *   1. Encrypt content with AES-256-GCM
 *   2. Prefer Pinata IPFS; otherwise retain ciphertext in the private DB column
 *   3. Update the DB row with envelope fields and no plaintext
 *
 * Idempotent: skips items already marked ipfs_encrypted or db_encrypted.
 * Requires: CONTENT_MASTER_KEY in .env.local. PINATA_JWT is optional.
 *
 * Run: node --import tsx --no-warnings --env-file-if-exists=.env.local scripts/migrate-content-to-ipfs.mts
 */

import { getDb } from "../lib/db/index.ts";
import { hasContentKey } from "../lib/ipfs/content-crypto.ts";
import { storeSourceItem } from "../lib/sources/store-source-item.ts";

async function main() {
  if (!hasContentKey()) {
    console.error("CONTENT_MASTER_KEY is not set or invalid. Cannot run migration.");
    process.exit(1);
  }

  const db = await getDb();
  await db.init();

  // Encrypt inactive/history rows too. They are off the earning rail, but deactivation must not
  // leave paid plaintext behind on disk or in the Supabase table.
  const sources = await db.listAllSources();
  console.log(`Found ${sources.length} sources (active and inactive).`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const source of sources) {
    const items = await db.getItems(source.id);
    for (const item of items) {
      // Already migrated — skip.
      if (item.storageMode === "ipfs_encrypted" || item.storageMode === "db_encrypted") {
        skipped++;
        continue;
      }
      // No plaintext content to migrate — skip.
      if (!item.content) {
        skipped++;
        continue;
      }

      try {
        const stored = await storeSourceItem(item, { requireEncrypted: true });
        await db.addItems([stored]);
        const destination = stored.ipfsCid
          ? `IPFS ${stored.ipfsCid}`
          : "encrypted DB fallback";
        console.log(`  [ok] item ${item.id} (${item.title.slice(0, 50)}) → ${destination}`);
        migrated++;
      } catch (err) {
        console.error(`  [fail] item ${item.id}:`, err instanceof Error ? err.message : err);
        failed++;
      }
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
