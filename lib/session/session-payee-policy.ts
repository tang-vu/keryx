/**
 * The bound the signer worker applies to everything it is asked to sign.
 *
 * The browser's per-source payTo check (lib/payments/client-payto-allowlist.ts) runs on the main
 * thread, which is exactly what an XSS owns. This policy runs inside the worker, next to the key,
 * and is derived from data the worker fetches itself — so injected script cannot widen it.
 *
 * It is deliberately coarser than the main-thread check: the worker is handed an EIP-712 message,
 * not a source id, so it can only ask "is this payee authorised for *some* listed source?". That
 * is enough to change what an attacker gains. Owning the page lets them make the user pay a
 * registered creator; it does not let them name themselves as the payee. The precise
 * source→payee binding stays the main thread's job, where it has the sourceId to do it.
 *
 * Transactions are bounded the same way: the session EOA holds spendable USDC before it reaches
 * the Gateway, so the worker signs transactions only to the USDC contract and the Gateway wallet.
 * A plain value transfer sweeping that balance to an attacker is never signed.
 */

import { config } from "../config";
import { allowedPayTo } from "../registry/payto-guard";

const TTL_MS = 10 * 60_000;

interface PublicSource {
  walletAddress?: string;
  onchainId?: string;
}

let cache: { payees: ReadonlySet<string>; readAt: number } | null = null;

/**
 * Every wallet the registry authorises to be paid for any publicly listed source.
 * Throws rather than returning an empty set: signing against a set we failed to build would be
 * the same as not checking at all.
 */
export async function authorisedPayees(): Promise<ReadonlySet<string>> {
  if (cache && Date.now() - cache.readAt < TTL_MS) return cache.payees;

  const res = await fetch("/api/sources");
  if (!res.ok) throw new Error(`could not load the source index (HTTP ${res.status})`);
  const { sources = [] } = (await res.json()) as { sources?: PublicSource[] };

  const payees = new Set<string>();
  await Promise.all(
    sources.map(async (source) => {
      if (!source.walletAddress) return;
      if (!source.onchainId) {
        // Predates the registry; its payout wallet is public, so it stays enumerable.
        payees.add(source.walletAddress.toLowerCase());
        return;
      }
      const allowlist = await allowedPayTo(source.onchainId);
      if (allowlist.status === "onchain") {
        for (const wallet of allowlist.wallets) payees.add(wallet);
      } else {
        // Registry unreadable for this source — fall back to the wallet the server lists. The
        // main thread's per-source check refuses outright in this case; here, refusing would
        // take down every payment for every source at once.
        payees.add(source.walletAddress.toLowerCase());
      }
    }),
  );

  if (payees.size === 0) throw new Error("the source index yielded no authorised payees");

  cache = { payees, readAt: Date.now() };
  return payees;
}

/** Contracts the session EOA is allowed to transact with: approve USDC, deposit to the Gateway. */
export function isAllowedTransactionTarget(to: string | undefined | null): boolean {
  if (!to) return false; // contract creation from a session EOA is never legitimate
  const target = to.toLowerCase();
  return (
    target === config.usdcAddress.toLowerCase() || target === config.gatewayWallet.toLowerCase()
  );
}

/** Tests only. */
export function resetPayeePolicyCache(): void {
  cache = null;
}
