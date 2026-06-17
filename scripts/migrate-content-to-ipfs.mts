/**
 * migrate-content-to-ipfs.mts — one-time migration of existing DB content to IPFS.
 *
 * For each source_item that has plaintext content but no ipfs_cid:
 *   1. Encrypt content with AES-256-GCM (encryptContent)
 *   2. Pin ciphertext to Pinata IPFS (pinEncrypted)
 *   3. Update the DB row with CID + envelope fields; clear plaintext content
 *
 * Idempotent: skips items that already have ipfs_cid set.
 * Requires: PINATA_JWT + CONTENT_MASTER_KEY in .env.local
 *
 * Run: node --import tsx --no-warnings --env-file-if-exists=.env.local scripts/migrate-content-to-ipfs.mts
 */

import { getDb } from "../lib/db/index.ts";
import { hasPinata, pinEncrypted } from "../lib/ipfs/pinata-client.ts";
import { encryptContent, hasContentKey } from "../lib/ipfs/content-crypto.ts";

async function main() {
  if (!hasPinata()) {
    console.error("PINATA_JWT is not set. Cannot run migration.");
    process.exit(1);
  }
  if (!hasContentKey()) {
    console.error("CONTENT_MASTER_KEY is not set or invalid. Cannot run migration.");
    process.exit(1);
  }

  const db = await getDb();
  await db.init();

  const sources = await db.listSources();
  console.log(`Found ${sources.length} active sources.`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const source of sources) {
    const items = await db.getItems(source.id);
    for (const item of items) {
      // Already migrated — skip.
      if (item.ipfsCid) {
        skipped++;
        continue;
      }
      // No plaintext content to migrate — skip.
      if (!item.content) {
        skipped++;
        continue;
      }

      try {
        const envelope = encryptContent(item.content);
        const cipherBuf = Buffer.from(envelope.cipherB64, "base64");
        const cid = await pinEncrypted(cipherBuf, `keryx-item-${item.id}.enc`);

        // Write back the full item with IPFS fields + cleared plaintext.
        await db.addItems([{
          ...item,
          content: "",          // plaintext cleared; lives on IPFS only
          ipfsCid: cid,
          itemKeyEnc: envelope.wrappedKeyB64,
          itemIv: envelope.ivB64,
          itemAuthTag: envelope.authTagB64,
        }]);

        console.log(`  [ok] item ${item.id} (${item.title.slice(0, 50)}) → ${cid}`);
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
