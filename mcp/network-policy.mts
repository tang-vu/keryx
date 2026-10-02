import { paymentRuntimeConfig } from "../lib/payment-runtime-config.ts";
import { ARC_TESTNET_PROFILE } from "../lib/arc-network-profile.ts";
import { chainForProfile } from "../lib/chains.ts";

/** Captured trusted process configuration. A seller challenge or journal cannot choose a rail. */
export const callerConfig = paymentRuntimeConfig();
export const callerProfile = callerConfig.profile;
export const callerChain = chainForProfile(callerProfile);

/** Unlabelled historic journals are testnet originals. Never rewrite or relabel them. */
export class CallerJournalNetworkMismatch extends Error {
  constructor() { super("Original journal belongs to a different network; preserve it and recover with its original network configuration"); }
}
export function assertCallerJournalNetwork(network?: string): void {
  if ((network ?? ARC_TESTNET_PROFILE.networkId) !== callerProfile.networkId)
    throw new CallerJournalNetworkMismatch();
}

/** Mainnet question and authorization transport must stay encrypted; configuration is not a host allowlist. */
export function assertCallerTransport(url: string): string {
  try {
    const parsed = new URL(url);
    if (!callerProfile.testnet && (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)) throw new Error();
    return parsed.origin;
  } catch { throw new Error("Caller transport refused; mainnet requires HTTPS without credentials or fragments"); }
}
