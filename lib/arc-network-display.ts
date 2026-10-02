import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "./arc-network-profile";
import { browserPaymentProfile } from "./browser-payment-profile";

/** Display references confer no signing authority. Missing network is a legacy
 * testnet record; an unknown explicit network is never relabelled as this build. */
export function recordedArcProfile(network?: string): ArcNetworkProfile | undefined {
  if(network===undefined||network===ARC_TESTNET_PROFILE.networkId)return ARC_TESTNET_PROFILE;
  if(network===ARC_MAINNET_PROFILE.networkId)return ARC_MAINNET_PROFILE;
}
export function arcProfileLabel(profile: ArcNetworkProfile){return profile.testnet?profile.label:`${profile.label} mainnet`}
export const currentArcLabel=arcProfileLabel(browserPaymentProfile());
export function recordedArcLabel(network?:string){const profile=recordedArcProfile(network);return profile?arcProfileLabel(profile):"unknown network"}
export function recordedArcTransactionUrl(network:string|undefined,hash:string){
  const profile=recordedArcProfile(network);
  return profile&&/^0x[0-9a-fA-F]{64}$/.test(hash)?`${profile.explorerUrl}/tx/${hash}`:undefined;
}
export function recordedGatewayProfiles(records:ReadonlyArray<{network?:string}>){
  return [...new Set(records.map(record=>recordedArcProfile(record.network)).filter((p):p is ArcNetworkProfile=>!!p))];
}
