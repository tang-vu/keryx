import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import type { WithdrawPolicy } from "./withdraw-protocol";

/** A trusted canonical profile is selected before estimation or signing. */
export function assertWithdrawalNetworkPolicy(policy: Pick<WithdrawPolicy, "domain" | "gatewayWallet" | "gatewayMinter"> & Partial<Pick<WithdrawPolicy, "asset">>,
  profile: ArcNetworkProfile): ArcNetworkProfile {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Withdrawal profile unavailable");
  if (policy.domain !== profile.cctpDomain) throw new Error("Withdrawal domain unavailable");
  if (profile === ARC_MAINNET_PROFILE) {
    if (policy.gatewayWallet.toLowerCase() !== profile.gatewayWallet.toLowerCase() ||
      policy.gatewayMinter.toLowerCase() !== profile.gatewayMinter.toLowerCase() ||
      (policy.asset !== undefined && policy.asset.toLowerCase() !== profile.usdcAddress.toLowerCase()))
      throw new Error("Withdrawal contracts unavailable");
  } else if (policy.gatewayWallet.toLowerCase() === ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase() ||
    policy.gatewayMinter.toLowerCase() === ARC_MAINNET_PROFILE.gatewayMinter.toLowerCase()) {
    throw new Error("Withdrawal network relabeling refused");
  }
  return profile;
}
