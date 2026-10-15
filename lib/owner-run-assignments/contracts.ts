import { z } from "zod";
import { accountIdSchema, canonicalWalletSchema, digestSchema, interactiveSessionSchema, timeSchema } from "../accounts/contracts";
import { runClaimBindingSchema, runClaimDateSchema, runClaimIdSchema } from "../run-claims/contracts";

export const MAX_ASSIGNMENTS = 25;
export const MANIFEST_BYTES = 16_384;
export const EVENT_BYTES = 65_536;
export const CONSENT_TTL_MS = 86_400_000;
export const idSchema = z.string().uuid();
export const recipientSchema = z.object({ accountId: accountIdSchema, accountCreatedAt: timeSchema,
  wallet: canonicalWalletSchema, memberGeneration: digestSchema }).strict();
export type Recipient = z.infer<typeof recipientSchema>;
export const bindingSchema = runClaimBindingSchema.extend({ storageDigest: digestSchema }).strict();
export const memberSchema = z.object({ assignmentId: idSchema, runId: runClaimIdSchema,
  originalSha256: digestSchema, completedAt: runClaimDateSchema }).strict();
export const manifestSchema = z.object({ version: z.literal(1), binding: bindingSchema, recipient: recipientSchema,
  basis: z.object({ code: z.enum(["early-run-recovery", "documented-recipient-request"]),
    reference: z.string().regex(/^[A-Za-z0-9_:/.-]{1,128}$/) }).strict(),
  scope: z.literal("association-history-and-confirmation"), admissionExpiresAt: timeSchema,
  members: z.array(memberSchema).min(1).max(MAX_ASSIGNMENTS),
}).strict().refine(v => new Set(v.members.map(m => m.assignmentId)).size === v.members.length
  && v.members.every((m, i) => i === 0 || v.members[i - 1].runId < m.runId));
export type Manifest = z.infer<typeof manifestSchema>;
export const statusSchema = z.enum(["assigned-by-owner", "claimed", "rejected", "revoked"]);
export const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
export const associationSchema = z.object({ version: z.literal(1), manifest: manifestSchema, member: memberSchema,
  consentId: idSchema, applyId: idSchema, lastOperationId: idSchema, ordinal: z.number().int().min(0).max(24),
  status: statusSchema, revision: revisionSchema, assignedAt: timeSchema, confirmedAt: timeSchema.nullable(),
  decidedAt: timeSchema.nullable() }).strict();
export type Association = z.infer<typeof associationSchema>;
export const expectedSchema = z.object({ assignmentId: idSchema, revision: revisionSchema }).strict();
export const decisionSchema = z.object({ action: z.enum(["confirm", "reject", "withdraw"]), requestId: idSchema,
  expected: expectedSchema }).strict();
export const consentSchema = z.object({ action: z.literal("consent"), requestId: idSchema, manifest: manifestSchema,
  acknowledgeAssignedLabel: z.literal(true), noFinancialAuthority: z.literal(true) }).strict();
export const withdrawConsentSchema = z.object({ action: z.literal("withdraw-consent"), requestId: idSchema,
  consentId: idSchema, expected: z.array(expectedSchema).max(MAX_ASSIGNMENTS) }).strict();
export const recipientActionSchema = z.discriminatedUnion("action", [consentSchema, decisionSchema, withdrawConsentSchema]);
export type RecipientAction = z.infer<typeof recipientActionSchema>;
export const ownerActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("apply"), requestId: idSchema, manifest: manifestSchema, consentId: idSchema }).strict(),
  z.object({ action: z.enum(["undo", "cleanup"]), requestId: idSchema, applyId: idSchema,
    expected: z.array(expectedSchema).min(1).max(MAX_ASSIGNMENTS) }).strict(),
]);
export type OwnerAction = z.infer<typeof ownerActionSchema>;
export const resultSchema = z.object({ assignmentId: idSchema, revision: revisionSchema, status: statusSchema }).strict();
export const receiptSchema = z.object({ version: z.literal(1), requestId: idSchema, inputDigest: digestSchema,
  action: z.enum(["consent", "apply", "confirm", "reject", "withdraw", "withdraw-consent", "undo", "cleanup"]),
  committedAt: timeSchema, results: z.array(resultSchema).max(MAX_ASSIGNMENTS),
  meaning: z.literal("historical-committed-result-not-current-authority") }).strict();
export type Receipt = z.infer<typeof receiptSchema>;
export const eventSchema = z.object({ version: z.literal(1), actor: recipientSchema.or(z.object({ ownerId: z.literal("posix-uid:0"), ownerAuthorization: digestSchema }).strict()),
  input: z.union([recipientActionSchema, ownerActionSchema]),
  priorMembers: z.array(z.object({ assignmentId: idSchema, revision: revisionSchema.nullable(), status: statusSchema.nullable(),
    priorOperationId: idSchema.nullable() }).strict()).max(MAX_ASSIGNMENTS),
  credentialGeneration: digestSchema.nullable(), inputDigest: digestSchema, manifest: manifestSchema,
  consentId: idSchema.nullable(), consentAt: timeSchema.nullable(), priorOperationId: idSchema.nullable(),
  receipt: receiptSchema }).strict();
export type AssignmentEvent = z.infer<typeof eventSchema>;
export const sessionSchema = interactiveSessionSchema;
export class AssignmentError extends Error {
  constructor(readonly code: "assignment_unavailable" | "assignment_unauthenticated" | "assignment_conflict"
    | "assignment_ineligible" | "assignment_consent_required" | "assignment_arbitration_unavailable"
    | "assignment_owner_required" | "assignment_outcome_unresolved" | "invalid_assignment_request") { super(code); }
}
/** Sync reply is deliberate: revalidates current durable authority after the route's LAST await. */
export interface OwnerRunAssignmentsPort {
  act(session: z.infer<typeof sessionSchema>, expected: Recipient, input: RecipientAction, configuredOrigin: string): Receipt;
  reply(session: z.infer<typeof sessionSchema>, expectedWallet: string, configuredOrigin: string, expected?: Recipient, receipt?: Receipt): Response;
}
