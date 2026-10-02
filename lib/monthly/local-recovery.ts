import { addressSchema } from "../buyer/protocol";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { monthlyIdSchema } from "./protocol";

/** Historical testnet keys stay in place. Mainnet never reads that namespace. */
export function monthlyStorageKeys(profile: ArcNetworkProfile, owner?: string) {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Monthly profile refused");
  if (!profile.testnet && !owner) return null;
  const address = owner ? addressSchema.parse(owner).toLowerCase() : null;
  const prefix = profile.testnet ? "keryx.monthly" : `keryx.monthly.${profile.networkId}.https://keryx.cc.${address}`;
  return Object.freeze({ last: `${prefix}.last`, request: `${prefix}.request`,
    intent: (id: string) => `${prefix}.intent.${monthlyIdSchema.parse(id)}` });
}
