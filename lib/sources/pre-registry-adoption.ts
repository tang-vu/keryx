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
 * A row is claimed only for the wallet that already receives its payouts. Claiming is idempotent:
 * a creator who rejects the wallet prompt and submits the form again must get the same row back,
 * because everything downstream — the feed items, the webhook, the id handed to /verify — is keyed
 * by whatever this returns. A row already carrying a *different* id is left alone: it was
 * registered under another URL, so this is a genuinely different on-chain source, and abandoning
 * the old id would be worse than the duplicate.
 *
 * Returns the row this registration belongs to, or null on the ordinary path where the creator has
 * no prior row for this URL.
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
      s.walletAddress.toLowerCase() === wallet.toLowerCase() &&
      (sameUrl(s.url, canonicalUrl) || sameUrl(s.rssUrl, canonicalUrl)),
  );
  if (!prior) return null;

  if (prior.onchainId) {
    return prior.onchainId.toLowerCase() === onchainId.toLowerCase() ? prior : null;
  }

  const claimed: Source = { ...prior, onchainId };
  await db.upsertSource(claimed);
  return claimed;
}
