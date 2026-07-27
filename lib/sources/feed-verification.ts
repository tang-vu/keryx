/**
 * Feed-ownership verification — proof-of-control for the permissionless source registry.
 *
 * Listing a source is permissionless (anyone may paste any RSS feed), but EARNING is not.
 * The agent only reads/cites/pays a source once its owner has proven they control the feed:
 * the owner places a token carrying THEIR payout wallet anywhere in the feed. Only whoever
 * controls the feed's publishing pipeline can do that, so an impostor who lists a feed they
 * don't own (a major blog, someone else's newsletter) can never make that feed carry their
 * wallet — and therefore can never verify, never earn. That removes the incentive to squat
 * other people's feeds for citation rewards.
 *
 * The token binds to the wallet (not a random nonce) so it can't be replayed: a copied token
 * proves control of a DIFFERENT wallet, which the verifier rejects via the ownership check.
 */

import { fetchPublicText } from "../net/public-fetch";

const FETCH_TIMEOUT_MS = 15_000;
// Cap the scanned body so a hostile feed URL can't stream an unbounded response into memory.
const MAX_FEED_BYTES = 5_000_000;

/**
 * The exact line a creator places anywhere in their feed to prove control of `wallet`.
 * Lowercased so the on-feed token and the stored payout wallet compare case-insensitively.
 */
export function verificationToken(wallet: string): string {
  return `keryx-verify:${wallet.toLowerCase()}`;
}

/**
 * Fetch the raw feed and report whether it contains the verification token for `wallet`.
 * Scans the whole raw document case-insensitively, so the token survives in any field
 * (feed <description>, an <item>, a <category>, an HTML comment…). Any network/parse/HTTP
 * failure resolves to false — verification fails closed, never throws.
 */
export async function feedContainsToken(feedUrl: string, wallet: string): Promise<boolean> {
  const url = feedUrl?.trim();
  if (!url) return false;
  const token = verificationToken(wallet);

  try {
    const raw = await fetchPublicText(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_FEED_BYTES,
      maxHops: 3,
    });
    return raw.toLowerCase().includes(token);
  } catch {
    return false;
  }
}
