import { z } from "zod";
import { boundedPortableCopy } from "../research/bounded-portable-json";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";

export const MAX_PROCUREMENT_BYTES = 65_536;
const text = (max: number) => z.string().min(1).max(max).refine(isWellFormedUtf16).refine(value => value.trim().length > 0);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const signature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const micros = z.string().regex(/^(0|[1-9][0-9]{0,9})$/).refine(value => BigInt(value) <= BigInt(1_000_000_000));
const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/i.test(value));
const url = z.string().min(1).max(2048).url().refine(isWellFormedUtf16).refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && !/[<>"\s\u0000-\u001f\u007f-\u009f]/u.test(value);
});
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const ids = z.array(id).max(16).refine(unique);

export const procurementRequestSchema = z.object({
  id, network: z.enum(["eip155:5042", "eip155:5042002"]), decision: text(4000),
  budgetMicroUsdc: micros, expiresAt: z.string().datetime(),
  requirements: z.array(z.object({ id, question: text(2000), priority: z.number().int().min(1).max(10),
    status: z.enum(["missing", "covered"]) }).strict()).min(1).max(16)
    .refine(rows => unique(rows.map(row => row.id))),
}).strict();
export const procurementOfferSchema = z.object({
  id, requestHash: hash, providerWallet: wallet, sourceUrl: url, deliverable: text(2000),
  priceMicroUsdc: micros, requirementIds: ids.refine(values => values.length > 0),
  expiresAt: z.string().datetime(), nonce: id, signature: signature.optional(),
}).strict();
export const procurementDeliverySchema = z.object({
  offerId: id, offerHash: hash, body: text(40_000), bodyHash: hash,
  excerpts: z.array(z.object({ requirementId: id, start: z.number().int().min(0).max(40_000),
    end: z.number().int().min(1).max(40_000), stance: z.enum(["supports", "refutes", "inconclusive"]) }).strict())
    .min(1).max(16).refine(rows => unique(rows.map(row => row.requirementId))),
  signature: signature.optional(),
}).strict();
export const procurementReviewSchema = z.object({
  offerId: id, deliveryHash: hash, acceptedRequirementIds: ids, reviewer: text(120), reviewerNote: text(2000),
}).strict();
export const procurementPacketSchema = z.object({
  version: z.literal(1), scope: z.literal("private-evidence-procurement"), request: procurementRequestSchema,
  offers: z.array(procurementOfferSchema).max(16), selectedOfferIds: ids,
  deliveries: z.array(procurementDeliverySchema).max(16), reviews: z.array(procurementReviewSchema).max(16),
}).strict();

export type ProcurementRequest = z.infer<typeof procurementRequestSchema>;
export type ProcurementOffer = z.infer<typeof procurementOfferSchema>;
export type ProcurementDelivery = z.infer<typeof procurementDeliverySchema>;
export type ProcurementReview = z.infer<typeof procurementReviewSchema>;
export type EvidenceProcurementPacket = z.infer<typeof procurementPacketSchema>;

/** Imported data is a private proposal, never source, settlement or spend authority. */
export function parseEvidenceProcurement(value: unknown): EvidenceProcurementPacket {
  try { return procurementPacketSchema.parse(boundedPortableCopy(value, MAX_PROCUREMENT_BYTES)); }
  catch { throw new Error("Invalid private evidence procurement packet"); }
}
