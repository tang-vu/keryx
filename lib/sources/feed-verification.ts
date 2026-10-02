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

import { verificationToken } from "./feed-verification-token";
export { verificationToken } from "./feed-verification-token";

import { fetchPublicText } from "../net/public-fetch";

const FETCH_TIMEOUT_MS = 15_000;
// Cap the scanned body so a hostile feed URL can't stream an unbounded response into memory.
const MAX_FEED_BYTES = 5_000_000;

export type FeedTokenCheck = "present" | "missing" | "unavailable";

/** Bounded public fetch; distinguish absence from a failed read without exposing network internals. */
export async function checkFeedToken(feedUrl: string, wallet: string): Promise<FeedTokenCheck> {
  const url = feedUrl?.trim();
  if (!url) return "unavailable";
  try {
    const raw = await fetchPublicText(url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_FEED_BYTES, maxHops: 3 });
    return raw.toLowerCase().includes(verificationToken(wallet)) ? "present" : "missing";
  } catch { return "unavailable"; }
}

/** Registration retains the original fail-closed boolean contract. */
export async function feedContainsToken(feedUrl: string, wallet: string): Promise<boolean> {
  return await checkFeedToken(feedUrl, wallet) === "present";
}
