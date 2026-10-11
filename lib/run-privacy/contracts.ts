import { z } from "zod";
import type { QueryRun } from "../types";
import type { RunClaimBinding } from "../run-claims/contracts";

export const visibilitySchema = z.enum(["private", "unlisted", "public"]);
export type RunVisibility = z.infer<typeof visibilitySchema>;
export const privacyId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const privacyWallet = z.string().transform(value => value.toLowerCase()).pipe(z.string().regex(/^0x[a-f0-9]{40}$/));
export const privacySession = z.string().regex(/^[a-f0-9]{64}$/);
export const privacyMutation = z.object({ visibility: visibilitySchema.optional(), revision: z.number().int().min(0),
  requestId: z.string().uuid() }).strict();
export type PrivacyMutation = z.infer<typeof privacyMutation>;
export interface PrivacyActor { wallet: string; sessionHash?: string; binding: RunClaimBinding }
export interface PrivacyState { visibility: RunVisibility; revision: number; erased: boolean }
export interface PrivacyRead { exists: boolean; item: { run: QueryRun; state: PrivacyState } | null }
export interface PrivacyList { take: number; before?: { id: string; createdAt: string }; parentId?: string; ids?: string[] }
export const pendingPollSchema=z.object({queryId:z.string().regex(/^a2a_[a-f0-9]{64}$/),status:z.literal("running"),
  createdAt:z.string().max(64),startedAt:z.string().max(64).nullable(),amountUsdc:z.number().finite().nonnegative(),
  creatorBudgetUsdc:z.number().finite().nonnegative(),serviceFeeUsdc:z.number().finite().nonnegative(),
  transaction:z.string().regex(/^(?:0x[a-fA-F0-9]{64})?$/)}).strict();
export type PendingPoll=z.infer<typeof pendingPollSchema>;
export type PrivacyOffer=Pick<import("../types").GapIntent,"id"|"gapId"|"sourceId"|"sourceItemLink"|"itemId"|"contentVersion"|"articleOfferId"|"ownerWallet"|"status"|"attempts"|"retryRunId"|"coverage"|"rewardUsdc"|"createdAt"|"updatedAt">;
export interface RunPrivacyStore {
  /** Filters in storage before retrieving any text; hidden and erased originals never leave this port. */
  read(id: string, actor?: PrivacyActor): Promise<PrivacyRead>;
  list(query: PrivacyList): Promise<QueryRun[]>;
  /** Shared memory uses only publicly listed research; private topic text never becomes cross-owner context. */
  memories(take:number):Promise<import("../db/keryx-db").QueryMemoryEntry[]>;
  offers(take:number):Promise<PrivacyOffer[]>;
  /** Financial allowlist only, available independently of text visibility. */
  settlement(id: string): Promise<QueryRun | null>;
  /** Running orders without a saved run: bounded status/financial columns only, never worker input/result. */
  pending(id:string):Promise<PendingPoll|null>;
  owner(id: string, actor: PrivacyActor): Promise<{ run: QueryRun; state: PrivacyState } | null>;
  defaults(actor: PrivacyActor): Promise<RunVisibility>;
  setDefault(actor: PrivacyActor, visibility: RunVisibility, requestId: string): Promise<RunVisibility>;
  change(id: string, actor: PrivacyActor, input: PrivacyMutation): Promise<PrivacyState>;
  erase(id: string, actor: PrivacyActor, input: PrivacyMutation): Promise<PrivacyState>;
  export(id: string, actor: PrivacyActor, requestId: string): Promise<{ run: QueryRun; state: PrivacyState }>;
}
export class PrivacyError extends Error {
  constructor(public readonly code: "privacy_unavailable" | "not_found" | "conflict" | "unauthenticated" | "retention_hold") { super(code); }
}
export interface PrivacyStage { readonly runPrivacy?: RunPrivacyStore; readonly runPrivacyActive?: boolean }
/** Ordinary adapters capture the flag at construction. Existing admitted facades
 * retain their own authority checks; an active flag never selects their legacy reader. */
export function privacyReadsActive(db:PrivacyStage):boolean {
  return db.runPrivacyActive ?? (!!db.runPrivacy || process.env.KERYX_RUN_PRIVACY_ENABLED==="true");
}
export function requirePrivacy(db: PrivacyStage): RunPrivacyStore {
  if (!privacyReadsActive(db) || !db.runPrivacy) throw new PrivacyError("privacy_unavailable");
  return db.runPrivacy;
}
/** Exact financial counters and funding telemetry, without question-derived fields. */
export function erasedRun(run: QueryRun): QueryRun {
  const keys = ["id", "createdAt", "budget", "engine", "totalSpent", "totalToCreators", "asker", "askerFunded", "fundingOwner",
    "origin", "mcpClient", "durationMs", "paymentMode", "paymentAttempts", "settledPayments", "pendingPayments", "pendingSpendUsdc",
    "operatingFee", "usage", "provenance"] as const;
  const kept: Record<string, unknown> = {};
  for (const key of keys) if (Object.hasOwn(run, key)) kept[key] = run[key];
  return { ...kept, question: "", answer: "", subClaims: [], decisions: [], citations: [], trace: [] } as unknown as QueryRun;
}
export function validatePrivacyRun(raw: unknown, id?: string): QueryRun {
  const parsed = z.object({ id: privacyId, createdAt: z.string(), question: z.string(), answer: z.string(),
    budget: z.number().finite(), engine: z.string(), totalSpent: z.number().finite(), totalToCreators: z.number().finite(),
    subClaims: z.array(z.unknown()), decisions: z.array(z.unknown()), citations: z.array(z.unknown()), trace: z.array(z.unknown()) }).passthrough().parse(raw);
  if (id !== undefined && parsed.id !== id || Buffer.byteLength(JSON.stringify(parsed)) > 4_000_000) throw new PrivacyError("privacy_unavailable");
  return parsed as QueryRun;
}
