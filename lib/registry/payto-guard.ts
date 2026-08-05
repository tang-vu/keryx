/**
 * payto-guard — resolves the set of wallet addresses that may legitimately be paid
 * for a given source, reading the authority from the on-chain SourceRegistry.
 *
 * Why the chain and not the database:
 *   The `sources.authors` JSON column is a mutable file on the settlement host. Anyone
 *   who can write that file can silently redirect every future citation reward without
 *   touching a line of code. The registry record is not writable by the server — only
 *   the creator's own wallet can call update() — so it is the only trustworthy source
 *   of "who may receive money for this source".
 *
 * Both sides use this:
 *   - `/api/cite/[id]` (server) validates payTo before issuing the 402 challenge, which
 *     covers the volume-engine and A2A paths where no browser exists at all.
 *   - The browser validates payTo before signing an EIP-712 authorization. That signature
 *     is a bearer instrument — whoever holds it can move the funds to `to` — so a payTo
 *     the browser accepts is money already gone. Server-side validation cannot substitute
 *     for it.
 *
 * Availability policy is left to the caller via the tagged result, because the two sides
 * want opposite defaults: the server prefers to keep settling (liveness) while the browser
 * prefers to refuse (never sign an unverifiable bearer authorization).
 *
 * Sources registered before the on-chain registry existed have no `onchainId`; they
 * resolve to `unregistered` and the caller falls back to the publicly enumerable
 * source wallet. Those sources are the documented residual, not a silent hole.
 */

import type { Hex } from "viem";
import { config } from "../config";
import { getRegistrySource } from "./registry-client";

/** How long a successfully read allowlist is served without re-reading the chain. */
const TTL_MS = 10 * 60_000;

export type PayToAllowlist =
  /** Read from the chain. `stale` marks a cached set served after a failed refresh. */
  | {
      status: "onchain";
      wallets: ReadonlySet<string>;
      payoutWallet: string;
      stale: boolean;
    }
  /** No registry record — either the source predates the registry or none is configured. */
  | { status: "unregistered" }
  /** The chain could not be read and nothing was cached. Caller decides open vs closed. */
  | { status: "unavailable"; error: string };

interface CacheEntry {
  wallets: ReadonlySet<string>;
  payoutWallet: string;
  readAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Every address the registry authorises to receive money for this source:
 * the payout wallet plus each author in the split. Lowercased for comparison.
 */
function walletsOf(record: {
  payoutWallet: string;
  authors: ReadonlyArray<{ wallet: string }>;
}): ReadonlySet<string> {
  const set = new Set<string>([record.payoutWallet.toLowerCase()]);
  for (const a of record.authors) set.add(a.wallet.toLowerCase());
  return set;
}

/**
 * Resolve the on-chain allowlist for a source's registry id (bytes32).
 * Serves a cached set within TTL, and falls back to a stale set when the chain
 * read fails, so an RPC blip degrades to "slightly old truth" rather than "no truth".
 */
export async function allowedPayTo(onchainId: string): Promise<PayToAllowlist> {
  // A source that claims a registry id while no registry is configured means the guard is
  // silently doing nothing. Say so once, loudly — an inert check is worse than no check,
  // because it reads like protection.
  if (!config.registryReadAddress) {
    warnUnconfiguredOnce();
    return { status: "unregistered" };
  }

  const key = onchainId.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.readAt < TTL_MS) {
    return {
      status: "onchain",
      wallets: hit.wallets,
      payoutWallet: hit.payoutWallet,
      stale: false,
    };
  }

  try {
    const record = await getRegistrySource(onchainId as Hex);
    if (!record) return { status: "unregistered" };
    const wallets = walletsOf(record);
    const payoutWallet = record.payoutWallet;
    cache.set(key, { wallets, payoutWallet, readAt: Date.now() });
    return { status: "onchain", wallets, payoutWallet, stale: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // A previously-read set is far better than no check at all: authors change on a
    // human timescale, RPC nodes fail on a network one.
    if (hit) {
      return {
        status: "onchain",
        wallets: hit.wallets,
        payoutWallet: hit.payoutWallet,
        stale: true,
      };
    }
    return { status: "unavailable", error };
  }
}

/** Case-insensitive membership test against a resolved allowlist. */
export function isAllowed(wallets: ReadonlySet<string>, payTo: string): boolean {
  return wallets.has(payTo.toLowerCase());
}

let warned = false;
function warnUnconfiguredOnce(): void {
  if (warned) return;
  warned = true;
  console.error(
    "[payto-guard] KERYX_REGISTRY_READ_ADDRESS is unset — payees for on-chain sources are " +
      "falling back to the database. Set it (and its NEXT_PUBLIC_ twin) to enforce the guard.",
  );
}

/** Drops the cache. Tests only — production entries expire on their own. */
export function resetPayToCache(): void {
  cache.clear();
  warned = false;
}
