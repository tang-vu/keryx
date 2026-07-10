/**
 * pre-registry-adoption — lets a source listed before the on-chain registry existed keep its row
 * when its creator finally registers it on Arc.
 *
 * The indexer resolves an incoming registry event to a cache row by that row's `onchain_id`. A
 * source listed before the registry was switched on carries none, so a `SourceRegistered` event
 * would match nothing and the indexer would mint a *second* row beside the real one: same name,
 * new hash id, `verified` reset to false, no feed URL. The original keeps earning; the new row is
 * stranded, and the public source list shows the creator twice.
 *
 * Claiming the id on the existing row before the transaction is what makes the event land on it.
 * The id is a pure function of (creator, url) — no chain is needed to know it ahead of time. This
 * is the same ordering the backfill script relies on, for the same reason.
 */

import type { KeryxDB } from "@/lib/db/keryx-db";
import type { Source } from "@/lib/types";

/**
 * Whether two source URLs name the same document. A trailing slash and letter case are the two
 * differences a creator can introduce between listing a feed and registering it, and neither
 * changes what is fetched.
 */
export function sameUrl(a: string | undefined, b: string | undefined): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Write `onchainId` onto the row this creator already holds for this URL, so the indexer updates
 * it in place rather than duplicating it.
 *
 * A row is claimed only for the wallet that already receives its payouts, and never when it
 * already carries an id: re-registering under a different URL is a genuinely different on-chain
 * source, and the old id must not be silently abandoned.
 *
 * Returns the claimed row, or null on the ordinary path where the creator has no prior row.
 */
export async function claimOnchainIdForExistingSource(
  db: KeryxDB,
  wallet: string,
  canonicalUrl: string,
  onchainId: string,
): Promise<Source | null> {
  const rows = await db.listSources();
  const prior = rows.find(
    (s) =>
      !s.onchainId &&
      s.walletAddress.toLowerCase() === wallet.toLowerCase() &&
      (sameUrl(s.url, canonicalUrl) || sameUrl(s.rssUrl, canonicalUrl)),
  );
  if (!prior) return null;

  const claimed: Source = { ...prior, onchainId };
  await db.upsertSource(claimed);
  return claimed;
}
