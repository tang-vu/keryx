import { randomUUID } from "node:crypto";
import { recoverMessageAddress } from "viem";
import { z } from "zod";
import { config } from "../config";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import type { KeryxDB } from "../db/keryx-db";
import { getGatewayAvailableAtomic } from "../gateway/gateway-balance";
import { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage, parseSessionGrantConsent, type SessionGrantConsent } from "./session-grant-consent";

const budget = z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
export const mainnetGrantChallengeSchema = z.object({ sessAddr: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  budgetMicros: budget, recover: z.boolean().optional() }).strict();
export const mainnetGrantSubmissionSchema = z.object({ consent: z.unknown(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  sessionSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();

/** Deployment origin and TTL are independent trusted policy, never selected by a request. */
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
  if (!await db.browserJournalActive()) await db.activateBrowserJournal();
  const confirmedBefore = await db.browserSignerConfirmedSpendMicro(signer), retainedBefore = await db.browserSignerRetainedSpendMicro(signer);
  const available = await getGatewayAvailableAtomic(signer, config.profile);
  if (available === null || available <= BigInt(0) || available > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Session funding is unavailable");
  const confirmed = await db.browserSignerConfirmedSpendMicro(signer);
  const retained = await db.browserSignerRetainedSpendMicro(signer);
  if (!Number.isSafeInteger(confirmed) || confirmed < 0 || confirmed > retained || confirmed !== confirmedBefore || retained !== retainedBefore)
    throw new Error("Session recovery accounting changed or is unavailable");
  const requested = BigInt(body.budgetMicros), cumulative = BigInt(confirmed) + (requested < available ? requested : available);
  const consent = parseSessionGrantConsent({ format: "keryx-session-grant-consent-v1", network: config.profile.networkId,
    origin: policy.origin, ownerAddr: owner.toLowerCase(), sessAddr: signer, grantEpoch: randomUUID(),
    capMicroUsdc: String(cumulative), expirySeconds: String(now + policy.ttlSeconds) }, config.profile);
  await db.issueSessionGrantConsent(consent);
  return { consent, funding: { availableMicroUsdc: String(available), confirmedSpentMicroUsdc: String(confirmed),
    retainedSpentMicroUsdc: String(retained), proposedRemainingMicroUsdc: String(cumulative > BigInt(retained) ? cumulative - BigInt(retained) : BigInt(0)) } };
}
export async function consumeMainnetSessionGrant(db: KeryxDB, owner: string, input: unknown): Promise<SessionGrantConsent> {
  const policy = mainnetGrantPolicy(), body = mainnetGrantSubmissionSchema.parse(input);
  const consent = parseSessionGrantConsent(body.consent, config.profile), now = Math.floor(Date.now() / 1000);
  if (consent.ownerAddr !== owner.toLowerCase() || consent.origin !== policy.origin || Number(consent.expirySeconds) <= now ||
      Number(consent.expirySeconds) > now + policy.ttlSeconds) throw new Error("Owner consent binding refused");
  const recovered = await recoverMessageAddress({ message: createSessionGrantConsentMessage(consent, config.profile),
    signature: body.signature as `0x${string}` });
  if (recovered.toLowerCase() !== consent.ownerAddr) throw new Error("Owner consent signature refused");
  const signer = await recoverMessageAddress({ message: createSessionGrantSignerProofMessage(consent, config.profile),
    signature: body.sessionSignature as `0x${string}` });
  if (signer.toLowerCase() !== consent.sessAddr) throw new Error("Session signer possession proof refused");
  await db.consumeSessionGrantConsent(consent, body.signature, body.sessionSignature);
  return consent;
}
