import { getAddress, maxUint256, pad, zeroAddress, type Hex } from "viem";
import type { ArcNetworkProfile } from "../arc-network-profile";
import { assertWithdrawalNetworkPolicy } from "./withdrawal-network";
import { withdrawPolicySchema, validateWithdrawIntent } from "./withdraw-protocol";

/** Pure unsigned builder usable by a server or worker. No wallet, key or transport. */
export function prepareWithdrawIntentForProfile(profile: ArcNetworkProfile, signer: string, valueMicros: string,
  recipient: string, maxFeeMicros: string) {
  const policy = withdrawPolicySchema.parse({ owner: getAddress(signer), recipient: getAddress(recipient),
    domain: profile.cctpDomain, gatewayWallet: profile.gatewayWallet, gatewayMinter: profile.gatewayMinter,
    asset: profile.usdcAddress, maxValueMicros: valueMicros, maxFeeMicros });
  assertWithdrawalNetworkPolicy(policy, profile);
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  const salt = `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
  const address = (value: string) => pad(value.toLowerCase() as Hex, { size: 32 });
  return validateWithdrawIntent({ maxBlockHeight: maxUint256.toString(), maxFee: maxFeeMicros,
    spec: { version: 1, sourceDomain: profile.cctpDomain, destinationDomain: profile.cctpDomain,
      sourceContract: address(profile.gatewayWallet), destinationContract: address(profile.gatewayMinter),
      sourceToken: address(profile.usdcAddress), destinationToken: address(profile.usdcAddress),
      sourceDepositor: address(policy.owner), destinationRecipient: address(policy.recipient), sourceSigner: address(policy.owner),
      destinationCaller: address(zeroAddress), value: valueMicros, salt, hookData: "0x" } }, policy).burnIntent;
}
