import type { Source } from "../types";
import { allowedPayTo } from "./payto-guard";

export interface SourceFetchTerms {
  payTo: string;
  /** SourceRegistry exact price in real mode; DB price for pre-registry/fallback sources. */
  listPriceUsdc: number;
  /** Only this creator may sign article offers. */
  creator: string;
  active: boolean;
  authority: "onchain" | "database";
  stale: boolean;
}

/** Resolve the source-level ceiling and payee from the same authority snapshot. */
export async function sourceFetchTerms(
  source: Source,
  options: { refresh?: boolean } = {},
): Promise<SourceFetchTerms> {
  const fallback = (): SourceFetchTerms => ({
    payTo: source.walletAddress,
    listPriceUsdc: source.fetchPrice,
    creator: source.walletAddress,
    active: source.active !== false,
    authority: "database",
    stale: false,
  });
  if (!source.onchainId) return fallback();

  const allowlist = await allowedPayTo(source.onchainId, options);
  if (allowlist.status === "onchain") {
    if (allowlist.stale) {
      console.warn(
        `[source] using stale on-chain fetch terms for ${source.id} (RPC unreachable)`,
      );
    }
    return {
      payTo: allowlist.payoutWallet,
      listPriceUsdc: Number(allowlist.fetchPriceUsdc6) / 1_000_000,
      creator: allowlist.creator,
      active: allowlist.active,
      authority: "onchain",
      stale: allowlist.stale,
    };
  }
  if (allowlist.status === "unavailable") {
    console.error(
      `[source] on-chain fetch terms unavailable for ${source.id}: ${allowlist.error}`,
    );
  }
  return fallback();
}

/** Resolve a source fetch toll's payee from registry authority when a record exists. */
export async function sourceFetchPayTo(source: Source): Promise<string> {
  return (await sourceFetchTerms(source)).payTo;
}
