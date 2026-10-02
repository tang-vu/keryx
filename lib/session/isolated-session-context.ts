import { isAddress, keccak256, toHex, type Hex } from "viem";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";

/** Construct once inside a separately reviewed worker entry from trusted candidate enrollment.
 * This is not a worker message, environment selector or replacement for invite/admission authority.
 */
export interface IsolatedSessionContextInput {
  profile: ArcNetworkProfile;
  origin: string;
  owner: Hex;
  epoch: string;
  candidateDigest: Hex;
  maxPaymentMicroUsdc: string;
  expiresAtSeconds: number;
}

const refuse = (): never => { throw new Error("isolated session context refused"); };

export function createIsolatedSessionContext(input: IsolatedSessionContextInput) {
  if (!input || Object.keys(input).sort().join(",") !==
    "candidateDigest,epoch,expiresAtSeconds,maxPaymentMicroUsdc,origin,owner,profile") refuse();
  const { profile, origin, owner, epoch, candidateDigest, maxPaymentMicroUsdc, expiresAtSeconds } = input;
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) refuse();
  let url: URL;
  try { url = new URL(origin); } catch { refuse(); }
  if (url!.origin !== origin || url!.protocol !== "https:" || url!.username || url!.password) refuse();
  if (typeof owner !== "string" || !isAddress(owner) || /^0x0{40}$/i.test(owner) ||
      typeof epoch !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(epoch) ||
      typeof candidateDigest !== "string" || !/^0x[0-9a-f]{64}$/.test(candidateDigest) ||
      typeof maxPaymentMicroUsdc !== "string" || !/^[1-9]\d{0,4}$/.test(maxPaymentMicroUsdc) ||
      BigInt(maxPaymentMicroUsdc) > BigInt(10_000) ||
      !Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= 0) refuse();
  const normalizedOwner = owner.toLowerCase() as Hex;
  const derivationMessage = [
    "Keryx isolated spending session v2",
    `Origin: ${origin}`,
    `Network: ${profile.networkId}`,
    `USDC: ${profile.usdcAddress.toLowerCase()}`,
    `Gateway: ${profile.gatewayWallet.toLowerCase()}`,
    `Owner: ${normalizedOwner}`,
    `Candidate: ${candidateDigest}`,
    `Epoch: ${epoch}`,
    `Maximum per payment (micro-USDC): ${maxPaymentMicroUsdc}`,
    `Signing context expires (Unix seconds): ${expiresAtSeconds}`,
    "Sign only on the stated origin. This derives a separate browser-held key, not a transaction.",
    "Recovery requires the same exact context and a wallet that signs deterministically.",
  ].join("\n");
  const digest = keccak256(toHex(derivationMessage));
  return Object.freeze({ profile, origin, owner: normalizedOwner, epoch, candidateDigest,
    maxPaymentMicroUsdc, expiresAtSeconds, derivationMessage, digest,
    storageNamespace: `keryx-isolated-session-v2-${digest.slice(2)}` });
}

export type IsolatedSessionContext = ReturnType<typeof createIsolatedSessionContext>;
