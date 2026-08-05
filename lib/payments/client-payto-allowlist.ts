/** Browser-side payment authority resolved from the public index plus SourceRegistry. */
import { allowedPayTo } from "../registry/payto-guard";

export interface IndexedSource {
  walletAddress: string;
  fetchPrice?: number;
  /** bytes32 registry id, absent for sources that predate the on-chain registry. */
  onchainId?: string;
}

export type SourceIndex = ReadonlyMap<string, IndexedSource>;

export interface SourcePaymentAuthority {
  wallets: ReadonlySet<string>;
  /** Exact payout wallet for source fetch tolls; author wallets are citation-only. */
  fetchPayTo: string;
  creator: string;
  listPriceUsdc: number;
  onchain: boolean;
  active: boolean;
}

/** Fetch tolls go only to the source payout; citation rewards may go to an authorised author. */
export function isPaymentPayeeAllowed(
  authority: SourcePaymentAuthority,
  payTo: string,
  kind: "fetch" | "citation" | undefined,
): boolean {
  const requestedPayee = payTo.toLowerCase();
  return kind === "fetch"
    ? requestedPayee === authority.fetchPayTo
    : authority.wallets.has(requestedPayee);
}

/**
 * Resolve payees, creator, and list-price ceiling together. A null result means refuse to sign.
 * `refresh` bypasses the registry cache for the final browser check before money is committed.
 */
export async function resolveSourcePaymentAuthority(
  sourceId: string,
  index: SourceIndex,
  options: { refresh?: boolean } = {},
): Promise<SourcePaymentAuthority | null> {
  const entry = index.get(sourceId);
  if (!entry) return null;

  const fallback = (): SourcePaymentAuthority => ({
    wallets: new Set([entry.walletAddress.toLowerCase()]),
    fetchPayTo: entry.walletAddress.toLowerCase(),
    creator: entry.walletAddress,
    listPriceUsdc: Number(entry.fetchPrice ?? 0),
    onchain: false,
    active: true,
  });
  if (!entry.onchainId) return fallback();

  const allowlist = await allowedPayTo(entry.onchainId, options);
  switch (allowlist.status) {
    case "onchain":
      return {
        wallets: allowlist.wallets,
        fetchPayTo: allowlist.payoutWallet.toLowerCase(),
        creator: allowlist.creator,
        listPriceUsdc: Number(allowlist.fetchPriceUsdc6) / 1_000_000,
        onchain: true,
        active: allowlist.active,
      };
    case "unregistered":
      return fallback();
    case "unavailable":
      return null;
  }
}

/** Backward-compatible payee-only view used by citation and session policy checks. */
export async function resolveAllowedPayTo(
  sourceId: string,
  index: SourceIndex,
): Promise<ReadonlySet<string> | null> {
  return (await resolveSourcePaymentAuthority(sourceId, index))?.wallets ?? null;
}

/** Build the index from the public `/api/sources` payload. */
export function buildSourceIndex(
  sources: ReadonlyArray<{
    id?: string;
    walletAddress?: string;
    fetchPrice?: number;
    onchainId?: string;
  }>,
): SourceIndex {
  const index = new Map<string, IndexedSource>();
  for (const source of sources) {
    if (!source.id || !source.walletAddress) continue;
    index.set(source.id, {
      walletAddress: source.walletAddress,
      fetchPrice: source.fetchPrice,
      onchainId: source.onchainId,
    });
  }
  return index;
}
