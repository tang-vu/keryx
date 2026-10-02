import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { normalizeDoi } from "./doi";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(v => v.toLowerCase());
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v.toLowerCase());
const bounded = z.string().trim().min(1).max(2000);
export const paperDeclarationSchema = z.object({
  protocol: z.literal("keryx-scholarly-rights-v1"), network: z.literal("eip155:5042002"),
  deploymentOrigin: z.string().url().max(2000),
  sourceId: z.string().min(1).max(256), itemId: z.string().min(1).max(256),
  registry: address, onchainId: hash, creator: address, recipient: address,
  priceMicros: z.string().regex(/^[1-9]\d{0,6}$/),
  canonicalUrl: z.string().url().max(2000), contentVersion: bounded, bodyHash: hash,
  plaintextBytes: z.number().int().positive().max(2_000_000), manifestId: hash,
  manuscriptVersion: z.enum(["author-manuscript", "accepted-manuscript", "publisher-authorized-version"]),
  role: z.enum(["author", "authorized-publisher"]), doi: z.string().trim().max(256)
    .refine(v => !v || !!normalizeDoi(v), "Claimed DOI must use valid DOI syntax")
    .transform(v => v ? normalizeDoi(v)! : ""),
  license: bounded, permissionEvidence: bounded, commercialDistribution: z.literal(true),
  redistributionScope: bounded, attributionConditions: bounded, revocationContact: bounded,
  effectiveAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
  embargoUntil: z.string().datetime({ offset: true }),
  nonce: hash,
}).strict().refine(d => Date.parse(d.expiresAt) > Math.max(Date.parse(d.effectiveAt), Date.parse(d.embargoUntil)),
  "Permission expiry must follow effective and embargo dates");
export type PaperDeclaration = z.infer<typeof paperDeclarationSchema>;
export const paperDecisionSchema = z.object({
  protocol: z.literal("keryx-scholarly-review-v1"), declarationId: hash,
  previousDecisionId: hash.nullable(), reviewer: address,
  outcome: z.enum(["approved", "rejected", "suspended", "revoked"]),
  policyRevision: z.literal("supervised-testnet-v1"),
  evidence: bounded, rationale: bounded, publicSummary: z.string().trim().min(1).max(500),
  reviewedAt: z.string().datetime({ offset: true }), nonce: hash,
}).strict();
export type PaperDecision = z.infer<typeof paperDecisionSchema>;
export const signedPaperDeclarationSchema = z.object({ declaration: paperDeclarationSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();
export const signedPaperDecisionSchema = z.object({ decision: paperDecisionSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();
export type SignedPaperDeclaration = z.infer<typeof signedPaperDeclarationSchema>;
export type SignedPaperDecision = z.infer<typeof signedPaperDecisionSchema>;
export function paperDeclarationMessage(declaration: PaperDeclaration): string {
  return `Keryx scholarly distribution rights (Arc testnet only)\n${canonicalJson(paperDeclarationSchema.parse(declaration))}`;
}
export function paperDecisionMessage(decision: PaperDecision): string {
  return `Keryx supervised scholarly review (Arc testnet only)\n${canonicalJson(paperDecisionSchema.parse(decision))}`;
}
export interface PaperState {
  sourceId: string; declarationId: string; submission: SignedPaperDeclaration;
  decisionId: string | null; review: SignedPaperDecision | null;
}
