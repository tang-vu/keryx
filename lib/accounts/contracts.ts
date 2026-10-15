import { z } from "zod";
import type { QueryRun } from "../types";
import type { PrivacyState } from "../run-privacy/contracts";
import type { RunOwnership } from "../run-claims/history";

export const MEMBERSHIP_TTL_MS = 300_000;
export const MAX_ACCOUNT_WALLETS = 8;
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const accountIdSchema = z.string().regex(/^acct_[a-f0-9]{64}$/);
export const canonicalWalletSchema = z.string().regex(/^0x[a-f0-9]{40}$/).refine(v => v !== `0x${"0".repeat(40)}`);
export const walletInputSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(v => v.toLowerCase()).refine(v => v !== `0x${"0".repeat(40)}`);
export const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const timeSchema = z.number().int().min(0).max(8_640_000_000_000_000 - MEMBERSHIP_TTL_MS);
export const bindingSchema = z.object({
  origin: z.string().max(2048).refine(value => {
    try { const url = new URL(value); return url.origin === value && (url.protocol === "https:" || url.protocol === "http:" && url.hostname === "localhost"); }
    catch { return false; }
  }),
  network: z.enum(["eip155:5042", "eip155:5042002"]),
}).strict();
export type AccountBinding = z.infer<typeof bindingSchema>;

/** Internal only: caller must authenticate JWT and compare its exact durable row first.
 * Hashes are selectors, never credentials. This object must never come from JSON. */
export const interactiveSessionSchema = z.object({
  sessionHash: digestSchema, wallet: canonicalWalletSchema,
  issuedAt: timeSchema, expiresAt: timeSchema,
}).strict().refine(s => s.expiresAt > s.issuedAt && s.expiresAt - s.issuedAt <= 604_800_000);
export type InteractiveSession = z.infer<typeof interactiveSessionSchema>;

export const accountConsentSchema = z.object({
  version: z.literal(1), privateAccount: z.literal(true), shareOwnedHistory: z.literal(true),
}).strict();
export const linkConsentSchema = z.object({
  version: z.literal(1), sharePastAndFutureOwnedHistory: z.literal(true), walletAuthorityStaysSeparate: z.literal(true),
}).strict();
export type AccountConsent = z.infer<typeof accountConsentSchema>;
export type LinkConsent = z.infer<typeof linkConsentSchema>;

export const memberSchema = z.object({ wallet: canonicalWalletSchema, generation: digestSchema, linkedAt: timeSchema }).strict();
export const membershipSchema = z.object({
  version: z.literal(1), accountId: accountIdSchema, revision: revisionSchema,
  createdAt: timeSchema, members: z.array(memberSchema).min(1).max(MAX_ACCOUNT_WALLETS),
}).strict().refine(v => new Set(v.members.map(m => m.wallet)).size === v.members.length
  && new Set(v.members.map(m => m.generation)).size === v.members.length);
export type Membership = z.infer<typeof membershipSchema>;

export const snapshotSchema = z.object({ membership: membershipSchema, session: interactiveSessionSchema,
  memberGeneration: digestSchema, credentialGeneration: digestSchema, binding: bindingSchema,
}).strict();
export type AccountSnapshot = z.infer<typeof snapshotSchema>;
/** Private request-local observations from the genuine owner port, never JSON input. */
export interface AccountHistoryObservation {
  id: string;
  ownerWallet: string;
  run: QueryRun;
  state: PrivacyState;
  /** Present only when that attribution is part of a returned list/export row. */
  ownership?: RunOwnership;
}
/** One-use native synchronous check. No IO may be awaited after invoking it. */
export type AccountHistorySeal = () => void;
export const preconditionSchema = z.object({ accountId: accountIdSchema, revision: revisionSchema }).strict();
export type AccountPrecondition = z.infer<typeof preconditionSchema>;

export const challengeSchema = z.object({
  version: z.literal(1), purpose: z.enum(["create-private-account", "link-wallet"]),
  accountId: accountIdSchema, revision: revisionSchema, wallet: canonicalWalletSchema,
  generation: digestSchema, sessionCommitment: digestSchema, consentHash: digestSchema,
  binding: bindingSchema, issuedAt: timeSchema, expiresAt: timeSchema,
}).strict().refine(v => v.expiresAt === v.issuedAt + MEMBERSHIP_TTL_MS);
export type MembershipChallenge = z.infer<typeof challengeSchema>;
export interface IssuedMembershipChallenge { nonce: string; challenge: MembershipChallenge; message: string }
/** This lease never leaves the server. Invalid/aborted attempts stay consumed. */
export interface TakenMembershipChallenge { challenge: MembershipChallenge; nonce: string; lease: string }

export class AccountError extends Error {
  constructor(readonly code: "account_unavailable" | "account_unauthenticated" | "account_changed" | "invalid_membership_proof"
    | "wallet_unavailable" | "account_full" | "last_credential" | "invalid_account_request") { super(code); }
}
export interface AccountMembershipStore {
  offer(session: InteractiveSession, binding: AccountBinding): Promise<AccountPrecondition | null>;
  resolve(session: InteractiveSession, binding: AccountBinding): Promise<AccountSnapshot | null>;
  resume(session: InteractiveSession, binding: AccountBinding, expected: AccountPrecondition, consent: AccountConsent): Promise<AccountSnapshot>;
  issue(session: InteractiveSession, challenge: MembershipChallenge, nonceHash: string): Promise<void>;
  take(session: InteractiveSession, binding: AccountBinding, nonce: string, purpose: MembershipChallenge["purpose"], lease: string): Promise<TakenMembershipChallenge>;
  complete(session: InteractiveSession, taken: TakenMembershipChallenge, proofDigest: string): Promise<AccountSnapshot>;
  unlink(snapshot: AccountSnapshot, wallet: string, generation: string): Promise<Membership | null>;
  revokeSession(snapshot: AccountSnapshot): Promise<void>;
  assertCurrent(snapshot: AccountSnapshot): Promise<void>;
  /** Optional native capability only; absence cannot authorize account history. */
  prepareHistoryFence?(snapshot: AccountSnapshot, observed: readonly AccountHistoryObservation[], deadline: number): Promise<AccountHistorySeal>;
}
