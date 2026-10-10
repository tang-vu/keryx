import { z } from "zod";

export const RUN_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
export const runClaimTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const runClaimHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const runClaimIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
  .refine(value => !value.startsWith("prv_") && !value.startsWith("a2a_"));
export const runClaimWalletSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase());
export const runClaimDateSchema = z.string().datetime().refine(value => {
  const stamp = Date.parse(value);
  return Number.isSafeInteger(stamp) && stamp >= 0 && new Date(stamp).toISOString() === value;
});
export const runClaimBindingSchema = z.object({
  network: z.enum(["eip155:5042", "eip155:5042002"]),
  origin: z.string().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return url.origin === value && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
        && (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    } catch { return false; }
  }),
}).strict();
export type RunClaimBinding = z.infer<typeof runClaimBindingSchema>;
export const runClaimIssueSchema = z.object({
  runId: runClaimIdSchema, tokenHash: runClaimHashSchema, completedAt: runClaimDateSchema,
  binding: runClaimBindingSchema,
}).strict();
export type RunClaimIssue = z.infer<typeof runClaimIssueSchema>;
export const runClaimIssuanceSchema = z.object({
  version: z.literal(1), runId: runClaimIdSchema, binding: runClaimBindingSchema,
  issuedAt: runClaimDateSchema, expiresAt: runClaimDateSchema,
}).strict().refine(value => Date.parse(value.expiresAt) - Date.parse(value.issuedAt) === RUN_CLAIM_TTL_MS);
export type RunClaimIssuance = z.infer<typeof runClaimIssuanceSchema>;
export const runClaimAttemptSchema = z.object({
  tokenHash: runClaimHashSchema, wallet: runClaimWalletSchema, sessionHash: runClaimHashSchema,
  binding: runClaimBindingSchema,
}).strict();
export type RunClaimAttempt = z.infer<typeof runClaimAttemptSchema>;
export const runClaimReceiptSchema = z.object({
  version: z.literal(1), runId: runClaimIdSchema, wallet: runClaimWalletSchema,
  claimedAt: runClaimDateSchema, binding: runClaimBindingSchema,
}).strict();
export type RunClaimReceipt = z.infer<typeof runClaimReceiptSchema>;
export const runClaimDeliverySchema = z.object({
  version: z.literal(1), claimUrl: z.string().max(2200).refine(value => {
    try {
      const url = new URL(value);
      return url.href === value && url.pathname === "/claim-run" && !url.search && !url.username && !url.password
        && /^#[a-f0-9]{64}$/.test(url.hash) && runClaimBindingSchema.safeParse({ origin: url.origin, network: "eip155:5042" }).success;
    } catch { return false; }
  }), expiresAt: runClaimDateSchema,
}).strict();
export type RunClaimDelivery = z.infer<typeof runClaimDeliverySchema>;

/** Internal completion writer only. No lookup, reissue, transfer or raw token storage. */
export interface RunClaimsStore {
  assertAvailable(): Promise<void>;
  issue(input: RunClaimIssue): Promise<RunClaimIssuance>;
  /** Rechecks the active durable SIWE session and exact original in the same write transaction. */
  claim(input: RunClaimAttempt): Promise<RunClaimReceipt>;
}
export class RunClaimError extends Error {
  constructor(readonly code: "claims_unavailable" | "claim_unavailable" | "claim_unauthenticated") { super(code); }
}
export function requireRunClaims(db: { readonly runClaims?: RunClaimsStore }): RunClaimsStore {
  try { if (db.runClaims) return db.runClaims; } catch { /* No fallback from sealed/unknown capability. */ }
  throw new RunClaimError("claims_unavailable");
}
/** Source preparation does not activate any existing store, including ordinary SQLite. */
export function runClaimsEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED === "true";
}
