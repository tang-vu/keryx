import { z } from "zod";

export const deliverableIdSchema = z.string().regex(/^a2a_[0-9a-f]{64}$/);
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const walletSchema = z.string().regex(/^0x[0-9a-f]{40}$/);
export const networkSchema = z.enum(["eip155:5042", "eip155:5042002"]);
const wellFormed = (text: string) => {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
};
export const acceptanceInputSchema = z.object({
  originalFingerprint: digestSchema, deliveredDigest: digestSchema,
  expectedRevision: z.number().int().min(0).max(99),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  choice: z.enum(["accept", "revise", "reject"]),
  reason: z.string().max(1000).refine(wellFormed).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)).default(""),
  publishState: z.boolean().default(false),
}).strict();
export type AcceptanceInput = z.infer<typeof acceptanceInputSchema>;
export const acceptanceAuthoritySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session"), id: digestSchema }).strict(),
  z.object({ kind: z.literal("api-key"), id: z.string().min(1).max(128) }).strict(),
]);
export type AcceptanceAuthority = z.infer<typeof acceptanceAuthoritySchema>;
export const acceptanceEntrySchema = acceptanceInputSchema.extend({
  revision: z.number().int().min(1).max(100), submittedAt: z.string().datetime(),
}).strict();
export type AcceptanceEntry = z.infer<typeof acceptanceEntrySchema>;
export const acceptanceSnapshotSchema = z.object({
  format: z.literal("keryx-deliverable-acceptance-v1"), id: deliverableIdSchema,
  wallet: walletSchema, network: networkSchema, originalFingerprint: digestSchema, deliveredDigest: digestSchema, answerDigest: digestSchema,
  deliveryFormat: z.literal("retained-a2a-response-json-v1"),
  revision: z.number().int().min(0).max(100),
  state: z.enum(["no_response", "accepted", "revision_requested", "rejected"]),
  submittedAt: z.string().datetime().nullable(), reason: z.string().max(1000).nullable(), publishState: z.boolean(),
  terms: z.object({ remedy: z.literal("none"), responseWindow: z.null(), silence: z.literal("no_response") }).strict(),
  revisionExecution: z.literal("withheld"), refundExecution: z.literal("withheld"),
  review: z.enum(["not_requested", "owner_review_required"]),
  pendingPaymentLegs: z.boolean(), paidMicros: z.string().regex(/^[1-9][0-9]{0,15}$/),
  funding: z.literal("prepaid-a2a"),
}).strict();
export type AcceptanceSnapshot = z.infer<typeof acceptanceSnapshotSchema>;
export const publicAcceptanceSchema = z.object({
  format: z.literal("keryx-public-deliverable-state-v1"),
  state: z.enum(["not_shared", "accepted", "revision_requested", "rejected"]),
  submittedAt: z.string().datetime().nullable(),
}).strict();
export type PublicAcceptance = z.infer<typeof publicAcceptanceSchema>;
export const acceptanceMetricsSchema = z.object({
  format: z.literal("keryx-deliverable-choice-counts-v1"), scope: z.literal("consented-current-prepaid-a2a"),
  accepted: z.number().int().min(0).max(1000), revisionRequested: z.number().int().min(0).max(1000), rejected: z.number().int().min(0).max(1000),
  outsideCustomers: z.null(), team: z.null(), noResponse: z.null(), acceptanceRate: z.null(),
  classification: z.literal("unmeasured"),
}).strict();
export type AcceptanceMetrics = z.infer<typeof acceptanceMetricsSchema>;
export class AcceptanceError extends Error {
  constructor(public readonly code: "acceptance_unavailable" | "acceptance_conflict" | "acceptance_unauthenticated") { super(code); }
}
export interface DeliverableAcceptanceStore {
  read(owner: string, network: string, id: string): Promise<AcceptanceSnapshot>;
  submit(owner: string, network: string, id: string, input: AcceptanceInput, authority: AcceptanceAuthority): Promise<AcceptanceSnapshot>;
  publicState(network: string, id: string): Promise<PublicAcceptance>;
  metrics(network: string): Promise<AcceptanceMetrics>;
}
export function requireDeliverableAcceptance(db: { deliverableAcceptance?: DeliverableAcceptanceStore }): DeliverableAcceptanceStore {
  if (!db.deliverableAcceptance) throw new AcceptanceError("acceptance_unavailable");
  return db.deliverableAcceptance;
}
export function acceptanceWallet(raw: string) { return walletSchema.parse(raw.toLowerCase()); }
