import { z } from "zod";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";

const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => !/^0x0{40}$/.test(value));
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const origin = z.string().refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && url.origin === value && !url.username && !url.password; }
  catch { return false; }
});
const network = z.custom<typeof ARC_MAINNET_PROFILE>(value => canonicalJson(value) === canonicalJson(ARC_MAINNET_PROFILE));
const enrollmentSchema = z.object({
  format: z.literal("keryx-mainnet-enrollment-v1"),
  candidateDigest: digest,
  releaseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  origin,
  network,
  registryAddress: address,
  invitedBuyers: z.array(address).min(1).max(5),
  retainedTestnetSigners: z.array(address).min(1).max(100),
  approvedSourceIds: z.array(z.string().regex(/^0x[0-9a-f]{64}$/)).min(1).max(5),
  approvedCreatorAddresses: z.array(address).min(1).max(5),
  approvedPayoutAddresses: z.array(address).min(1).max(10),
  limits: z.object({ totalMicros: z.number().int().positive().max(1_000_000),
    perBuyerMicros: z.number().int().positive().max(250_000), perAskMicros: z.number().int().positive().max(50_000),
    perPaymentMicros: z.number().int().positive().max(10_000), maxAsks: z.number().int().positive().max(20) }).strict(),
  epoch: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  expiresAtSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

export type PublicMainnetEnrollment = Readonly<z.infer<typeof enrollmentSchema>>;

/** Public artifact data only. Parsing never confers enrollment, spend or launch authority. */
export function parsePublicMainnetEnrollment(input: unknown): PublicMainnetEnrollment {
  const parsed = enrollmentSchema.parse(input);
  const { limits: l } = parsed;
  if (l.perPaymentMicros > l.perAskMicros || l.perAskMicros > l.perBuyerMicros || l.perBuyerMicros > l.totalMicros)
    throw new Error("mainnet public enrollment limits refused");
  for (const list of [parsed.invitedBuyers, parsed.retainedTestnetSigners, parsed.approvedSourceIds,
    parsed.approvedCreatorAddresses, parsed.approvedPayoutAddresses]) {
    if (new Set(list).size !== list.length) throw new Error("mainnet public enrollment participants refused");
    Object.freeze(list);
  }
  if ([...parsed.invitedBuyers, ...parsed.approvedCreatorAddresses, ...parsed.approvedPayoutAddresses]
    .some(value => parsed.retainedTestnetSigners.includes(value))) throw new Error("mainnet public enrollment signer isolation refused");
  // Replace the caller's parsed network object with the canonical immutable local profile.
  parsed.network = ARC_MAINNET_PROFILE;
  Object.freeze(parsed.limits);
  return Object.freeze(parsed);
}

/** SHA-256 of the complete reviewed canonical artifact, including source/participant and release pins.
 * Draft candidateDigest is a preparation label; this final digest is the signing identity.
 */
export async function publicMainnetEnrollmentDigest(input: unknown): Promise<string> {
  const parsed = parsePublicMainnetEnrollment(input);
  const bytes = new TextEncoder().encode(canonicalJson(parsed));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Expected digest/origin must come from the reviewed build/host pins, never from a request. */
export async function verifyPublicMainnetEnrollment(input: unknown, expectedDigest: string, expectedOrigin: string) {
  const enrollment = parsePublicMainnetEnrollment(input);
  if (!digest.safeParse(expectedDigest).success || enrollment.origin !== expectedOrigin ||
    await publicMainnetEnrollmentDigest(enrollment) !== expectedDigest) throw new Error("mainnet public enrollment pin refused");
  return Object.freeze({ enrollment, enrollmentDigest: expectedDigest });
}
export type VerifiedPublicMainnetEnrollment = Awaited<ReturnType<typeof verifyPublicMainnetEnrollment>>;

export const pilotGrantFieldsSchema = z.object({
  owner: address, signer: address,
  grantEpoch: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  capMicroUsdc: z.string().regex(/^[1-9]\d{0,5}$/),
  expirySeconds: z.string().regex(/^[1-9]\d{0,15}$/),
}).strict();
export type PilotGrantFields = z.infer<typeof pilotGrantFieldsSchema>;

/** Separate owner delegation, never the derivation bearer signature. Caller must verify recovered
 * owner, freshness, single-use grant epoch and observed funded balance before grant admission.
 */
export function createPilotGrantMessage(verified: VerifiedPublicMainnetEnrollment, input: PilotGrantFields): string {
  const fields = pilotGrantFieldsSchema.parse(input), e = verified.enrollment;
  if (!e.invitedBuyers.includes(fields.owner) || fields.owner === fields.signer ||
    e.retainedTestnetSigners.includes(fields.signer) ||
    BigInt(fields.capMicroUsdc) > BigInt(e.limits.perBuyerMicros) ||
    BigInt(fields.expirySeconds) > BigInt(e.expiresAtSeconds)) throw new Error("mainnet owner delegation refused");
  return ["Keryx invited mainnet browser grant v1", `Origin: ${e.origin}`, `Network: ${ARC_MAINNET_PROFILE.networkId}`,
    `Enrollment: ${verified.enrollmentDigest}`, `Owner: ${fields.owner}`, `Session signer: ${fields.signer}`,
    `Grant epoch: ${fields.grantEpoch}`, `Cap (micro-USDC): ${fields.capMicroUsdc}`,
    `Expiry (Unix seconds): ${fields.expirySeconds}`,
    "Authorize only this bounded browser session. This is separate from session-key derivation."].join("\n");
}
