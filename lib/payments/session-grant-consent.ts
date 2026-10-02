import { z } from "zod";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";

const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => !/^0x0{40}$/.test(value));
const positiveInteger = z.string().regex(/^[1-9][0-9]{0,15}$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
export const sessionGrantConsentSchema = z.object({
  format: z.literal("keryx-session-grant-consent-v1"),
  network: z.enum(["eip155:5042002", "eip155:5042"]),
  origin: z.string().max(2048), ownerAddr: address, sessAddr: address,
  grantEpoch: z.string().uuid().regex(/^[0-9a-f-]{36}$/),
  capMicroUsdc: positiveInteger, expirySeconds: positiveInteger,
}).strict();
export type SessionGrantConsent = Readonly<z.infer<typeof sessionGrantConsentSchema>>;

/** Pure contract for server and worker. The caller supplies its independently trusted canonical profile. */
export function parseSessionGrantConsent(input: unknown, profile: ArcNetworkProfile): SessionGrantConsent {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Session grant profile refused");
  const fields = sessionGrantConsentSchema.parse(input), origin = new URL(fields.origin);
  const localTestnet = profile === ARC_TESTNET_PROFILE && origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (fields.network !== profile.networkId || fields.ownerAddr === fields.sessAddr ||
      origin.origin !== fields.origin || origin.username || origin.password ||
      (!localTestnet && origin.protocol !== "https:") || BigInt(fields.expirySeconds) > BigInt(253402300799))
    throw new Error("Session grant binding refused");
  return Object.freeze(fields);
}

/** This public delegation signature is separate from the secret session-key derivation signature. */
export function createSessionGrantConsentMessage(input: unknown, profile: ArcNetworkProfile): string {
  const fields = parseSessionGrantConsent(input, profile);
  return ["Keryx session payment grant", `Protocol: ${fields.format}`, `Network: ${profile.networkId}`,
    `Chain ID: ${profile.chainId}`, `USDC: ${profile.usdcAddress.toLowerCase()}`,
    `Gateway wallet: ${profile.gatewayWallet.toLowerCase()}`, `Origin: ${fields.origin}`,
    `Owner: ${fields.ownerAddr}`, `Session signer: ${fields.sessAddr}`, `Grant epoch: ${fields.grantEpoch}`,
    `Cumulative payment cap (micro-USDC): ${fields.capMicroUsdc}`, `Expires at (Unix seconds): ${fields.expirySeconds}`,
    "Scope: browser x402 payments using this session signer.",
    "Revocation stops future server admission; exposed authorizations and deposited Gateway funds remain."].join("\n");
}
