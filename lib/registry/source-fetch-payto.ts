import type { Source } from "../types";
import { allowedPayTo } from "./payto-guard";

/** Resolve a source fetch toll's payee from registry authority when a record exists. */
export async function sourceFetchPayTo(source: Source): Promise<string> {
  if (!source.onchainId) return source.walletAddress;

  const allowlist = await allowedPayTo(source.onchainId);
  if (allowlist.status === "onchain") {
    if (allowlist.stale) {
      console.warn(
        `[source] using stale on-chain payout authority for ${source.id} (RPC unreachable)`,
      );
    }
    return allowlist.payoutWallet;
  }
  if (allowlist.status === "unavailable") {
    console.error(
      `[source] on-chain payout check unavailable for ${source.id}: ${allowlist.error}`,
    );
  }

  // Same documented liveness fallback as citation settlement: sources with no readable registry
  // record use the indexed DB wallet, while operators receive a loud error on RPC failure.
  return source.walletAddress;
}
