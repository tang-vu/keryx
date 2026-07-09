"use client";

/**
 * Browser-side resolution of "which wallets may this payment go to".
 *
 * An EIP-712 TransferWithAuthorization is a bearer instrument: once the session key
 * signs one, whoever holds it can move that USDC to `to`. So the browser's payTo check
 * is not defence-in-depth behind the server — for the interactive path it is the last
 * check that runs before the money is committed. A sign-request naming an attacker's
 * address must be refused here or not at all.
 *
 * Two independent keys must agree before a payment is signed:
 *   1. The source must be publicly listed (present in the /api/sources index the browser
 *      fetched itself), so a fabricated source id cannot smuggle in an arbitrary payee.
 *   2. The payee must be authorised for that exact source by the on-chain SourceRegistry,
 *      which the settlement host cannot rewrite.
 * Tampering with only the database fails key 2; registering only on-chain fails key 1.
 *
 * Fetch tolls and citation rewards use the same allowlist — a source's payout wallet and
 * its author wallets are exactly the addresses the registry says may be paid for it.
 */

import { allowedPayTo } from "../registry/payto-guard";

/** The subset of /api/sources the browser needs to police payments. */
export interface IndexedSource {
  walletAddress: string;
  /** bytes32 registry id, absent for sources that predate the on-chain registry. */
  onchainId?: string;
}

export type SourceIndex = ReadonlyMap<string, IndexedSource>;

/**
 * Wallets this source may be paid at, or null when the browser cannot establish that
 * set — an unlisted source id, or a registry read that failed with nothing cached.
 * A null result means refuse to sign: skipping one citation costs a creator one reward,
 * signing an unverifiable authorization costs the user real USDC.
 */
export async function resolveAllowedPayTo(
  sourceId: string,
  index: SourceIndex,
): Promise<ReadonlySet<string> | null> {
  const entry = index.get(sourceId);
  if (!entry) return null;

  // Sources registered before the on-chain registry have no record to consult. Their
  // payout wallet is public, so it remains enumerable — just without the second key.
  if (!entry.onchainId) return new Set([entry.walletAddress.toLowerCase()]);

  const allowlist = await allowedPayTo(entry.onchainId);
  switch (allowlist.status) {
    case "onchain":
      return allowlist.wallets;
    case "unregistered":
      return new Set([entry.walletAddress.toLowerCase()]);
    case "unavailable":
      return null;
  }
}

/** Build the index from the public /api/sources payload. */
export function buildSourceIndex(
  sources: ReadonlyArray<{ id?: string; walletAddress?: string; onchainId?: string }>,
): SourceIndex {
  const index = new Map<string, IndexedSource>();
  for (const s of sources) {
    if (!s.id || !s.walletAddress) continue;
    index.set(s.id, { walletAddress: s.walletAddress, onchainId: s.onchainId });
  }
  return index;
}
