import { z } from "zod";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";

const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => !/^0x0{40}$/.test(value));
const positiveInteger = z.string().regex(/^[1-9][0-9]{0,15}$/)
  .refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
const consentFields = {
  network: z.enum(["eip155:5042002", "eip155:5042"]),
  origin: z.string().max(2048), ownerAddr: address, sessAddr: address,
  grantEpoch: z.string().uuid().regex(/^[0-9a-f-]{36}$/),
  capMicroUsdc: positiveInteger, expirySeconds: positiveInteger,
};
export const researchBudgetDurationSchema = z.union([z.literal(3600), z.literal(86400), z.literal(604800)]);
export const sessionGrantConsentSchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("keryx-session-grant-consent-v1"), ...consentFields }).strict(),
  z.object({ format: z.literal("keryx-session-grant-consent-v2"), ...consentFields,
    durationSeconds: researchBudgetDurationSchema, questionCapMicroUsdc: positiveInteger }).strict(),
]);
export type SessionGrantConsent = Readonly<z.infer<typeof sessionGrantConsentSchema>>;
/** v1's existing maximum stays fixed; only explicitly signed v2 carries longer authority. */
export function sessionGrantDurationSeconds(consent: SessionGrantConsent, legacySeconds = 86400): number {
  return consent.format === "keryx-session-grant-consent-v2" ? consent.durationSeconds : legacySeconds;
}

/** Pure contract for server and worker. The caller supplies its independently trusted canonical profile. */
export function parseSessionGrantConsent(input: unknown, profile: ArcNetworkProfile): SessionGrantConsent {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Session grant profile refused");
  const fields = sessionGrantConsentSchema.parse(input), origin = new URL(fields.origin);
  const localTestnet = profile === ARC_TESTNET_PROFILE && origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (fields.network !== profile.networkId || fields.ownerAddr === fields.sessAddr ||
      origin.origin !== fields.origin || origin.username || origin.password ||
      (!localTestnet && origin.protocol !== "https:") || BigInt(fields.expirySeconds) > BigInt(253402300799) ||
      (fields.format === "keryx-session-grant-consent-v2" && (profile !== ARC_MAINNET_PROFILE ||
        BigInt(fields.questionCapMicroUsdc) > BigInt(fields.capMicroUsdc))))
    throw new Error("Session grant binding refused");
  return Object.freeze(fields);
}

/** This public delegation signature is separate from the secret session-key derivation signature. */
export function createSessionGrantConsentMessage(input: unknown, profile: ArcNetworkProfile): string {
  const fields = parseSessionGrantConsent(input, profile);
  const message = ["Keryx session payment grant", `Protocol: ${fields.format}`, `Network: ${profile.networkId}`,
    `Chain ID: ${profile.chainId}`, `USDC: ${profile.usdcAddress.toLowerCase()}`,
    `Gateway wallet: ${profile.gatewayWallet.toLowerCase()}`, `Origin: ${fields.origin}`,
    `Owner: ${fields.ownerAddr}`, `Session signer: ${fields.sessAddr}`, `Grant epoch: ${fields.grantEpoch}`,
    `Cumulative payment cap (micro-USDC): ${fields.capMicroUsdc}`, `Expires at (Unix seconds): ${fields.expirySeconds}`,
    "Scope: browser x402 payments using this session signer.",
    "Revocation stops future server admission; exposed authorizations and deposited Gateway funds remain."];
  // Preserve every historical v1 byte, including its scope and final newline behavior.
  if (fields.format === "keryx-session-grant-consent-v2") message.splice(12, 0,
    `Research budget duration (seconds): ${fields.durationSeconds}`,
    `Maximum per question (micro-USDC): ${fields.questionCapMicroUsdc}`);
  return message.join("\n");
}

/** Public proof of session-key possession, distinct from owner delegation and secret derivation. */
export function createSessionGrantSignerProofMessage(input: unknown, profile: ArcNetworkProfile): string {
  return ["Keryx session signer possession", "Purpose: prove control of the session signer for this exact owner payment grant.",
    createSessionGrantConsentMessage(input, profile)].join("\n");
}
