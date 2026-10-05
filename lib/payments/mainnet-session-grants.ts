import { randomUUID } from "node:crypto";
import { recoverMessageAddress } from "viem";
import { z } from "zod";
import { config } from "../config";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import type { KeryxDB } from "../db/keryx-db";
import { getGatewayAvailableAtomic } from "../gateway/gateway-balance";
import { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage, parseSessionGrantConsent,
  researchBudgetDurationSchema, sessionGrantDurationSeconds, type SessionGrantConsent } from "./session-grant-consent";

const budget = z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
export const mainnetGrantChallengeSchema = z.object({ sessAddr: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  budgetMicros: budget, recover: z.boolean().optional(), renew: z.boolean().optional(), addFunds: z.boolean().optional(),
  durationSeconds: researchBudgetDurationSchema.optional(), questionCapMicroUsdc: budget.optional(),
}).strict().refine(body => (body.durationSeconds === undefined) === (body.questionCapMicroUsdc === undefined),
  "Choose both duration and per-question maximum").refine(body => !(body.renew && body.addFunds), "Choose renewal or additional budget");
export const mainnetGrantSubmissionSchema = z.object({ consent: z.unknown(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  sessionSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();

/** Deployment origin and legacy TTL remain trusted. v2 accepts only the fixed signed duration choices. */
export function mainnetGrantPolicy() {
  if (config.profile !== ARC_MAINNET_PROFILE) throw new Error("Mainnet grant profile unavailable");
  const origin = new URL(config.baseUrl), ttl = config.sessionGrantTtlSeconds;
  if (origin.protocol !== "https:" || origin.origin !== config.baseUrl || origin.username || origin.password ||
    !Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 86400) throw new Error("Mainnet grant deployment policy unavailable");
  return Object.freeze({ origin: origin.origin, ttlSeconds: ttl });
}
export function requireMainnetGrantOrigin(req: Request): void {
  const policy = mainnetGrantPolicy();
  if (req.headers.get("origin") !== policy.origin || new URL(req.url).origin !== policy.origin)
    throw new Error("Same-origin request required");
}
export async function issueMainnetSessionGrant(db: KeryxDB, owner: string, input: unknown) {
  const policy = mainnetGrantPolicy(), body = mainnetGrantChallengeSchema.parse(input), now = Math.floor(Date.now() / 1000);
  const signer = body.sessAddr.toLowerCase();
  let renewalAuthority: Awaited<ReturnType<KeryxDB["getSessionGrantConsent"]>> = null;
  if (body.renew || body.addFunds) {
    // The latest retained grant survives revoke/expiry. A public historical selector cannot
    // substitute an older, larger cap for the owner's most recent consent.
    const previous = await db.getSessionGrant(owner.toLowerCase());
    if (!previous || previous.ownerAddr.toLowerCase() !== owner.toLowerCase() || previous.sessAddr.toLowerCase() !== signer)
      throw new Error("Original research budget unavailable for renewal");
    renewalAuthority = await db.getSessionGrantConsent(owner.toLowerCase(), previous.grantEpoch);
    if (!renewalAuthority) throw new Error("Original research budget proof unavailable");
    const original = parseSessionGrantConsent(renewalAuthority.consent, config.profile);
    if (original.ownerAddr !== owner.toLowerCase() || original.sessAddr !== signer || original.origin !== policy.origin ||
      original.grantEpoch !== previous.grantEpoch || Number(original.capMicroUsdc) !== Math.round(previous.cap*1e6) ||
      (previous.expiry !== 0 && Number(original.expirySeconds)*1000 !== previous.expiry) ||
      (await recoverMessageAddress({ message: createSessionGrantConsentMessage(original, config.profile),
        signature: renewalAuthority.ownerSignature as `0x${string}` })).toLowerCase() !== original.ownerAddr ||
      (await recoverMessageAddress({ message: createSessionGrantSignerProofMessage(original, config.profile),
        signature: renewalAuthority.sessionSignature as `0x${string}` })).toLowerCase() !== signer)
      throw new Error("Original research budget proof refused");
    renewalAuthority = { ...renewalAuthority, consent: original };
  }
  if (!await db.browserJournalActive()) await db.activateBrowserJournal();
  const confirmedBefore = await db.browserSignerConfirmedSpendMicro(signer), retainedBefore = await db.browserSignerRetainedSpendMicro(signer);
  const available = await getGatewayAvailableAtomic(signer, config.profile);
  if (available === null || available <= BigInt(0) || available > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Session funding is unavailable");
  const confirmed = await db.browserSignerConfirmedSpendMicro(signer);
  const retained = await db.browserSignerRetainedSpendMicro(signer);
  if (!Number.isSafeInteger(confirmed) || confirmed < 0 || confirmed > retained || confirmed !== confirmedBefore || retained !== retainedBefore)
    throw new Error("Session recovery accounting changed or is unavailable");
  const requested = BigInt(body.budgetMicros);
  let cumulative = BigInt(confirmed) + (requested < available ? requested : available);
  if (body.renew && renewalAuthority && cumulative > BigInt(renewalAuthority.consent.capMicroUsdc)) cumulative = BigInt(renewalAuthority.consent.capMicroUsdc);
  const original = renewalAuthority?.consent;
  const durationSeconds = body.durationSeconds ?? (original?.format === "keryx-session-grant-consent-v2" ? original.durationSeconds : undefined);
  const questionCapMicroUsdc = body.questionCapMicroUsdc ?? (original?.format === "keryx-session-grant-consent-v2" ? original.questionCapMicroUsdc : undefined);
  const remainingFunded = cumulative-BigInt(confirmed);
  const selectedCapacity = body.renew || body.addFunds ? cumulative : requested < remainingFunded ? requested : remainingFunded;
  if (body.questionCapMicroUsdc !== undefined && BigInt(body.questionCapMicroUsdc) > selectedCapacity)
    throw new Error("Per-question maximum exceeds the selected funded budget");
  const consent = parseSessionGrantConsent({ format: durationSeconds === undefined ? "keryx-session-grant-consent-v1" : "keryx-session-grant-consent-v2", network: config.profile.networkId,
    origin: policy.origin, ownerAddr: owner.toLowerCase(), sessAddr: signer, grantEpoch: randomUUID(),
    capMicroUsdc: String(cumulative), expirySeconds: String(now + (durationSeconds ?? policy.ttlSeconds)),
    ...(durationSeconds === undefined ? {} : { durationSeconds, questionCapMicroUsdc }) }, config.profile);
  await db.issueSessionGrantConsent(consent);
  return { consent, funding: { availableMicroUsdc: String(available), confirmedSpentMicroUsdc: String(confirmed),
    retainedSpentMicroUsdc: String(retained), proposedRemainingMicroUsdc: String(cumulative > BigInt(retained) ? cumulative - BigInt(retained) : BigInt(0)) },
    ...(renewalAuthority ? { renewalAuthority } : {}) };
}
export async function consumeMainnetSessionGrant(db: KeryxDB, owner: string, input: unknown): Promise<SessionGrantConsent> {
  const policy = mainnetGrantPolicy(), body = mainnetGrantSubmissionSchema.parse(input);
  const consent = parseSessionGrantConsent(body.consent, config.profile), now = Math.floor(Date.now() / 1000);
  if (consent.ownerAddr !== owner.toLowerCase() || consent.origin !== policy.origin || Number(consent.expirySeconds) <= now ||
      Number(consent.expirySeconds) > now + sessionGrantDurationSeconds(consent, policy.ttlSeconds)) throw new Error("Owner consent binding refused");
  const recovered = await recoverMessageAddress({ message: createSessionGrantConsentMessage(consent, config.profile),
    signature: body.signature as `0x${string}` });
  if (recovered.toLowerCase() !== consent.ownerAddr) throw new Error("Owner consent signature refused");
  const signer = await recoverMessageAddress({ message: createSessionGrantSignerProofMessage(consent, config.profile),
    signature: body.sessionSignature as `0x${string}` });
  if (signer.toLowerCase() !== consent.sessAddr) throw new Error("Session signer possession proof refused");
  await db.consumeSessionGrantConsent(consent, body.signature, body.sessionSignature);
  return consent;
}
