import { keccak256, toHex } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";

/** Retained exactly for recovering existing funded testnet identities. */
export const LEGACY_SESSION_DERIVATION_MESSAGE =
  "Keryx spending session key v1\n\n" +
  "Sign to derive your in-browser spending session. This is NOT a transaction and " +
  "costs no gas. Signing the same message always recreates the same session, so your " +
  "funds are never lost. Only sign this on keryx.cc.";

/** Stable custody identity, independent of mutable grant caps/epochs. Changing it rotates the
 * funded signer, so migrations must retain the exact old context and an owner recovery path.
 */
export function browserSessionCustodyContext(profile: ArcNetworkProfile, origin: string, owner: string) {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Session custody profile refused");
  const url = new URL(origin), localTestnet = profile === ARC_TESTNET_PROFILE && url.protocol === "http:" &&
    ["localhost","127.0.0.1","[::1]"].includes(url.hostname);
  if (url.origin !== origin || url.username || url.password || (!localTestnet && url.protocol !== "https:") ||
    !/^0x[0-9a-fA-F]{40}$/.test(owner) || /^0x0{40}$/i.test(owner)) throw new Error("Session custody identity refused");
  const identity = Object.freeze({ format: "keryx-browser-session-custody-v3", profile, origin, owner: owner.toLowerCase() });
  const digest = keccak256(toHex(canonicalJson(identity)));
  const derivationMessage = profile === ARC_TESTNET_PROFILE ? LEGACY_SESSION_DERIVATION_MESSAGE : [
    "Keryx browser spending session key v3", `Origin: ${origin}`, `Owner: ${identity.owner}`,
    `Network: ${profile.networkId}`, `Chain ID: ${profile.chainId}`, `USDC: ${profile.usdcAddress.toLowerCase()}`,
    `Gateway wallet: ${profile.gatewayWallet.toLowerCase()}`, `Custody identity: ${digest}`,
    "This signature derives a session key; it is not a transaction or server delegation.",
    "Recovery depends on retained encrypted storage in this browser. Repeating a wallet signature is not a universal backup.",
    "Deposited Gateway funds remain after logout; lost browser key storage can lose access to them.",
  ].join("\n");
  return Object.freeze({ ...identity, digest, derivationMessage, storageNamespace: `keryx-browser-session-v3-${digest.slice(2)}` });
}
export function browserSessionDerivationMessage(profile: ArcNetworkProfile, origin: string, owner: string): string {
  return browserSessionCustodyContext(profile, origin, owner).derivationMessage;
}
export type BrowserSessionCustodyContext = ReturnType<typeof browserSessionCustodyContext>;
