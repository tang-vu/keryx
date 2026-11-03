import { createHash } from "node:crypto";
import { z } from "zod";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { normalizeStatement } from "../llm/cited-statement";
import type { ProposedEvidence } from "../llm/reasoning-engine";
import type { CitedStatement } from "../agent/cited-statements";
import { MIN_REWARD_SUPPORT, type EvidenceLedger } from "../agent/evidence-ledger";
import { validWorkProductRequest, workProductRequestSchema, type WorkProductRequest } from "./work-product-request";

const plain = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum).refine(isWellFormedUtf16)
  .refine(value => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]|\[\s*S\d+\s*\]/u.test(value));
const premiseId = z.string().regex(/^e(?:[1-9]|[12]\d|3[0-2])$/u);
const premiseIds = z.array(premiseId).min(1).max(4).refine(ids => new Set(ids).size === ids.length);
const sectionSchema = z.object({ id: z.string().regex(/^w[1-6]$/u), heading: plain(80), text: plain(600),
  premiseIds, conditions: z.array(plain(180)).max(2) }).strict();
const premiseSchema = z.object({ id: premiseId, statement: z.object({ claimIndex: z.number().int().min(0).max(7),
  marker: z.string().regex(/^S\d+$/u), quote: z.string().min(8).max(240).refine(isWellFormedUtf16), text: plain(321, 12) }).strict() }).strict();
const bodySchema = z.object({ version: z.literal(1), originalQuestion: z.string().min(1).max(30_000),
  request: workProductRequestSchema, premises: z.array(premiseSchema).max(32), sections: z.array(sectionSchema).min(1).max(6) }).strict();
export type WorkProductSection = z.infer<typeof sectionSchema>;
export interface WorkProductPacket extends z.infer<typeof bodySchema> { digest: string }
export type WorkProductGap = "invalid-request" | "invalid-product" | "review-unavailable" | "review-rejected" | "final-premise-withheld" | "criteria-unmet";
export interface PreparedWorkProduct { packet?: WorkProductPacket; gaps: WorkProductGap[] }
export interface ReviewedWorkProduct { packet: WorkProductPacket; acceptedSectionIds: string[]; acceptedCriteria: number[] }
const reviewed = new WeakMap<ReviewedWorkProduct, string>();
const digest = (body: z.infer<typeof bodySchema>) => createHash("sha256").update(JSON.stringify(body)).digest("hex");
const seal = (value: ReviewedWorkProduct) => JSON.stringify([value.packet.digest, value.acceptedSectionIds, value.acceptedCriteria]);
const dependencies = (section: WorkProductSection, premises: WorkProductPacket["premises"]) => {
  const rows = section.premiseIds.map(id => premises.find(row => row.id === id));
  return rows.every(Boolean) && new Set(rows.map(row => JSON.stringify(row?.statement))).size === rows.length;
};

export function prepareWorkProduct(request: WorkProductRequest, originalQuestion: string,
  evidence: readonly ProposedEvidence[], rawSections: unknown): PreparedWorkProduct {
  if (!validWorkProductRequest(request, originalQuestion)) return { gaps: ["invalid-request"] };
  const sections = z.array(sectionSchema).min(1).max(6).safeParse(rawSections);
  if (!sections.success || evidence.length > 32 || new Set(sections.data.map(row => row.id)).size !== sections.data.length)
    return { gaps: ["invalid-product"] };
  // Preserve evidence positions, including rejected/unresolved entries.
  const premises = evidence.flatMap((row, index) => {
    const parsed = premiseSchema.safeParse({ id: `e${index + 1}`, statement: { claimIndex: row.claimIndex,
      marker: row.marker, quote: row.quote, text: normalizeStatement(row.statement) } });
    return parsed.success ? [parsed.data] : [];
  });
  if (!sections.data.every(row => dependencies(row, premises))) return { gaps: ["invalid-product"] };
  const body = structuredClone({ version: 1 as const, originalQuestion, request, premises, sections: sections.data });
  return { packet: { ...body, digest: digest(body) }, gaps: [] };
}

export function validWorkProductPacket(packet: WorkProductPacket): boolean {
  try {
    const { digest: retained, ...body } = packet;
    const parsed = bodySchema.safeParse(body);
    return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(body) && digest(body) === retained &&
      validWorkProductRequest(packet.request, packet.originalQuestion) &&
      new Set(packet.premises.map(row => row.id)).size === packet.premises.length &&
      new Set(packet.sections.map(row => row.id)).size === packet.sections.length &&
      packet.sections.every(row => dependencies(row, packet.premises));
  } catch { return false; }
}

const verdict = z.enum(["supported", "unsupported", "insufficient"]);
const reviewSchema = z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/u), sections: z.array(z.object({
  id: z.string().regex(/^w[1-6]$/u), premiseIds, premiseConsistency: verdict, proposalOnly: verdict,
  scope: verdict, conditions: verdict, language: verdict }).strict()).max(6),
  criteria: z.array(z.object({ index: z.number().int().min(0).max(2), status: verdict }).strict()).max(3) }).strict();

export function workProductReviewInput(packet: WorkProductPacket) {
  if (!validWorkProductPacket(packet)) throw new Error("Work product packet changed");
  return { packet: structuredClone(packet), schema: WORK_PRODUCT_REVIEW_SCHEMA, guidance: WORK_PRODUCT_REVIEW_GUIDANCE };
}

export function reviewWorkProduct(packet: WorkProductPacket, raw: unknown): ReviewedWorkProduct | undefined {
  if (!validWorkProductPacket(packet)) return;
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success || parsed.data.digest !== packet.digest || parsed.data.sections.length !== packet.sections.length ||
      new Set(parsed.data.sections.map(row => row.id)).size !== packet.sections.length ||
      parsed.data.criteria.length !== packet.request.criteria.length ||
      new Set(parsed.data.criteria.map(row => row.index)).size !== packet.request.criteria.length ||
      parsed.data.criteria.some(row => row.index >= packet.request.criteria.length)) return;
  const acceptedSectionIds: string[] = [];
  for (const row of parsed.data.sections) {
    const section = packet.sections.find(section => section.id === row.id);
    if (!section || JSON.stringify(row.premiseIds) !== JSON.stringify(section.premiseIds)) return;
    if ([row.premiseConsistency, row.proposalOnly, row.scope, row.conditions, row.language].every(value => value === "supported"))
      acceptedSectionIds.push(row.id);
  }
  const value = { packet: structuredClone(packet), acceptedSectionIds,
    acceptedCriteria: parsed.data.criteria.filter(row => row.status === "supported").map(row => row.index) };
  reviewed.set(value, seal(value)); return value;
}

export interface WorkProductDelivery {
  request: WorkProductRequest;
  sections: { section: WorkProductSection; premises: WorkProductPacket["premises"] }[];
  gaps: WorkProductGap[];
  /** A bounded model review of requested criteria, not human acceptance or truth. */
  criteriaReviewed: boolean;
}

/** Read-only final projection. A proposal never creates a factual statement,
 * citation weight or reward. Final facts and their exact physical source win. */
export function deliverWorkProduct(request: WorkProductRequest, value: ReviewedWorkProduct | undefined,
  ledger: EvidenceLedger, statements: readonly CitedStatement[], preparationGaps: readonly WorkProductGap[] = []): WorkProductDelivery {
  const sections: WorkProductDelivery["sections"] = [], gaps = [...preparationGaps];
  const packet = value?.packet;
  if (!value || !packet || !reviewed.has(value) || !validWorkProductPacket(packet) || reviewed.get(value) !== seal(value) ||
      JSON.stringify(packet.request) !== JSON.stringify(request)) gaps.push("review-unavailable");
  else {
    for (const section of packet.sections) {
      if (!value.acceptedSectionIds.includes(section.id)) { gaps.push("review-rejected"); continue; }
      const premises = packet.premises.filter(row => section.premiseIds.includes(row.id));
      if (!premises.every(({ statement }) => finalPremise(statement, ledger, statements))) { gaps.push("final-premise-withheld"); continue; }
      sections.push({ section: structuredClone(section), premises: structuredClone(premises) });
    }
    if (value.acceptedCriteria.length !== request.criteria.length) gaps.push("criteria-unmet");
  }
  return { request: structuredClone(request), sections, gaps: [...new Set(gaps)], criteriaReviewed: gaps.length === 0 && sections.length > 0 };
}

function finalPremise(statement: CitedStatement, ledger: EvidenceLedger, statements: readonly CitedStatement[]) {
  if (!statements.some(row => row.claimIndex === statement.claimIndex && row.marker === statement.marker &&
      row.quote === statement.quote && row.text === statement.text) || !ledger.acceptedMarkers.has(statement.marker) ||
      !((ledger.claimCoverage.find(row => row.claimIndex === statement.claimIndex)?.coverage ?? 0) >= MIN_REWARD_SUPPORT)) return false;
  const rows = ledger.evidence.filter(row => row.claimIndex === statement.claimIndex && row.marker === statement.marker &&
    row.quote === statement.quote && row.qualifiesForAnswer);
  return rows.length > 0 && rows.every(row => !!row.sourceId) && new Set(rows.map(row =>
    JSON.stringify([row.sourceId, row.itemId ?? null, row.itemUrl ?? null, row.contentVersion ?? null]))).size === 1;
}

export const WORK_PRODUCT_GENERATION_GUIDANCE =
  "Also return workProductSections for the original caller's explicit proposed deliverable. Do not replace or weaken factual evidence to fit this addition. " +
  "Use at most6 sections with unique IDs w1..w6, heading<=80 characters, text<=600, premiseIds of1-4 distinct e1..e32, and0-2 hypothetical conditions<=180 characters. " +
  "eN refers to the Nth returned evidence row, including unresolved rows, not the research target index. " +
  "Draft the requested plan, checklist or comparison as conditional proposals based on those facts and the original caller's constraints. Preserve time horizon, missing user inputs and source limitations. " +
  "Scheduling allocations may be explicitly proposed examples within the caller's horizon, never established efficacy, guarantees or invented facts about the user. " +
  "No new independent factual claims, source-performed/tested claims, citation markers, fabricated benchmarks, unsupported comparisons or medical/legal/financial recommendations. " +
  "This contract does not supply classroom activities, classification exercises, lesson scripts or exit questions; the separate teaching contract and activation gates still apply. " +
  "Use the caller's requested language. If grounded proposals cannot fit within the unchanged output budget, return workProductSections:[]; no extra generation is available. ";
export const WORK_PRODUCT_REVIEW_SCHEMA = '{"digest":string,"sections":[{"id":string,"premiseIds":string[],"premiseConsistency":"supported"|"unsupported"|"insufficient","proposalOnly":same verdict,"scope":same verdict,"conditions":same verdict,"language":same verdict}],"criteria":[{"index":number,"status":same verdict}]}';
export const WORK_PRODUCT_REVIEW_GUIDANCE =
  "Independently judge EVERY work product section against the ORIGINAL caller question, exact referenced factual statements/quotes and ALL factual source context. " +
  "Return the immutable digest and complete section IDs/ordered premiseIds. Review every caller criterion exactly once by its zero-based index. Missing evidence is unknown; never infer completion from an attractive format. " +
  "premiseConsistency requires all factual dependencies and qualifications; proposalOnly requires a clearly hypothetical draft with no new factual claim or source attribution. " +
  "scope requires the requested artifact and time horizon with no invented user ability, time availability, outcome guarantee or consequential medical/legal/financial recommendation. " +
  "Explicitly proposed schedule allocations can be hypothetical design choices, but measured efficacy and factual numerical thresholds require surviving evidence. " +
  "Classroom activities, lesson scripts, classification exercises and exit questions are outside this contract; reject them rather than bypassing the separate teaching activation gate. " +
  "conditions must remain hypothetical and preserve missing inputs; language must match the caller. Judge criteria over the whole requested deliverable, not one row. " +
  "Reject unsupported comparisons, new procedures claimed to be in a source and proposals requiring any unreviewed/rejected premise. Do not repair, rewrite or add facts. Uncertainty is insufficient. This review gives no factual coverage, execution, acceptance or payment authority.";
