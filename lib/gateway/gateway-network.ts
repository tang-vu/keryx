import {
  ARC_MAINNET_PROFILE,
  ARC_TESTNET_PROFILE,
  type ArcNetworkProfile,
} from "../arc-network-profile";

/** Read-only service selection from a canonical deployment or retained payment network.
 * Never use a response, cursor, environment URL override or the current deployment to
 * reinterpret a historical payment. Reference availability grants no signing authority.
 */
export function gatewayNetworkProfile(networkId: string): ArcNetworkProfile {
  if (networkId === ARC_TESTNET_PROFILE.networkId) return ARC_TESTNET_PROFILE;
  if (networkId === ARC_MAINNET_PROFILE.networkId) return ARC_MAINNET_PROFILE;
  throw new Error("unsupported Gateway payment network");
}
