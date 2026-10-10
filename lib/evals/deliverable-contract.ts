import { createHash } from "node:crypto";
import { z } from "zod";
import { boundedPortableCopy } from "../research/bounded-portable-json";

export const DELIVERABLE_SCHEMA_VERSION = 2;
export const MAX_DELIVERABLE_BYTES = 98304;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const index = z.number().int().min(0).max(31);
const identity = {
  claimIndex: index,
  marker: z.string().regex(/^S[1-9]\d{0,2}$/),
  sourceId: z.string().min(1).max(256),
  itemId: z.string().min(1).max(256),
  itemUrl: z.string().url().max(2048),
  contentVersion: digest,
};
const expectedBinding = z.object({ ...identity, quoteSha256: digest }).strict();
const observedBinding = z.object({ ...identity, quote: z.string().min(1).max(2048).refine(value => Boolean(value.trim())),
  qualifiesForAnswer: z.literal(true), qualifiesForReward: z.literal(false) }).strict();
export const deliverableContractSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), id: identifier,
  issues: z.array(z.number().int().positive()).min(1).max(16),
  kind: z.enum(["single-page", "exact-metadata", "comparison", "teaching-note", "newest-release"]),
  requestedLanguage: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
  questionSha256: digest,
  targets: z.array(z.object({ claimIndex: index, label: z.string().min(1).max(256) }).strict()).min(1).max(32),
  requiredBindings: z.array(expectedBinding).max(64),
  format: z.object({
    bulletCount: z.number().int().min(1).max(32).optional(),
    maxWhitespaceWords: z.number().int().min(1).max(30000).optional(),
    requestedSentenceCount: z.number().int().min(1).max(32).optional(),
    excludedBulletSuffixSha256: digest.optional(),
  }).strict(),
}).strict().refine(value => value.version === 2 || (value.requiredBindings.length > 0 &&
  value.format.requestedSentenceCount === undefined &&
  (value.format.bulletCount !== undefined || value.format.maxWhitespaceWords !== undefined)));
export const deliverableSnapshotSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), id: identifier, question: z.string().min(1).max(30000),
  answer: z.string().min(1).max(60000), answerSha256: digest,
  // Reviewed corpus ranges exclude only recorded scaffolding; they are not inferred from headings.
  bulletRegion: z.object({ start: z.literal(0), end: z.number().int().positive(), sha256: digest }).strict(),
  bindings: z.array(observedBinding).max(64),
  provenance: z.object({
    kind: z.literal("retained-public-report"),
    reportUrl: z.string().regex(/^https:\/\/keryx\.cc\/dispatch\/[a-f0-9-]{36}$/),
    capturedAt: z.string().datetime(), deployedCommit: z.string().regex(/^[a-f0-9]{40}$/),
    rawCaptureSha256: digest,
    projection: z.literal("question-answer-qualified-public-bindings-only"),
    retainedReceipt: z.object({ capturedAt: z.string().datetime(), rawCaptureSha256: digest,
      payloadSha256: digest }).strict().optional(),
  }).strict(),
}).strict().refine(value => value.version === 2 ? value.provenance.retainedReceipt !== undefined :
  value.bindings.length > 0 && value.provenance.retainedReceipt === undefined);

export type DeliverableContract = z.infer<typeof deliverableContractSchema>;
export type DeliverableSnapshot = z.infer<typeof deliverableSnapshotSchema>;
export type DeliverableCheck = { status: "PASS" | "FAIL" | "UNJUDGED"; detail: string };

export class DeliverableInputError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DeliverableInputError"; }
}
export function deliverableSha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function boundedParse<T>(schema: z.ZodType<T>, input: unknown): T {
  try { return schema.parse(boundedPortableCopy(input, MAX_DELIVERABLE_BYTES)); }
  catch { throw new DeliverableInputError("MALFORMED_OR_UNBOUNDED_INPUT"); }
}
function bindingKey(value: z.infer<typeof expectedBinding>): string {
  return JSON.stringify([value.claimIndex, value.marker, value.sourceId, value.itemId,
    value.itemUrl, value.contentVersion, value.quoteSha256]);
}
export function validateDeliverableInputs(contractInput: unknown, snapshotInput: unknown): {
  contract: DeliverableContract; snapshot: DeliverableSnapshot;
} {
  const contract = boundedParse(deliverableContractSchema, contractInput);
  const snapshot = boundedParse(deliverableSnapshotSchema, snapshotInput);
  if (contract.version !== snapshot.version || contract.id !== snapshot.id || contract.questionSha256 !== deliverableSha256(snapshot.question))
    throw new DeliverableInputError("CASE_OR_QUESTION_BINDING_MISMATCH");
  if (snapshot.answerSha256 !== deliverableSha256(snapshot.answer) ||
      snapshot.bulletRegion.end > snapshot.answer.length ||
      snapshot.bulletRegion.sha256 !== deliverableSha256(snapshot.answer.slice(0, snapshot.bulletRegion.end)))
    throw new DeliverableInputError("ANSWER_OR_REGION_DIGEST_MISMATCH");
  if (deliverableSha256(snapshot.answer.slice(snapshot.bulletRegion.end)) !==
      (contract.format.excludedBulletSuffixSha256 ?? deliverableSha256("")))
    throw new DeliverableInputError("UNREVIEWED_BULLET_REGION_BOUNDARY");
  const targetIds = contract.targets.map(target => target.claimIndex);
  const expectedKeys = contract.requiredBindings.map(bindingKey);
  const actualKeys = snapshot.bindings.map(binding => bindingKey({ ...binding, quoteSha256: deliverableSha256(binding.quote) }));
  if (new Set(targetIds).size !== targetIds.length || new Set(expectedKeys).size !== expectedKeys.length ||
      new Set(actualKeys).size !== actualKeys.length ||
      contract.requiredBindings.some(binding => !targetIds.includes(binding.claimIndex)) ||
      (contract.version === 1 && targetIds.some(target => !contract.requiredBindings.some(binding => binding.claimIndex === target))))
    throw new DeliverableInputError("DUPLICATE_OR_UNBOUND_TARGET");
  if (new Set(contract.issues).size !== contract.issues.length)
    throw new DeliverableInputError("DUPLICATE_ISSUE");
  return { contract, snapshot };
}

/** Version1 measures whitespace-delimited tokens, including headings/citations/warnings. */
export function whitespaceWordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
/** Unindented Markdown list rows only; code fences, quotes and nested rows are excluded. */
export function topLevelBulletCount(text: string): number {
  let count = 0, fence: { character: string; length: number } | undefined;
  for (const line of text.split(/\r?\n/u)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (!fence && /^[-+*] \S/u.test(line) && !/^([-+*])(?: \1){2,}\s*$/u.test(line)) count++;
  }
  return count;
}
function excerptAsDelivered(quote: string): string {
  // Existing ordinary excerpt escaping; preserve the source bytes separately in each binding.
  return quote.replace(/\[(S\d+)\]/g, "[\u200b$1]").replace(/[`*_]/g, "$&\u200b").replace(/[\r\n]+/g, " ");
}

/** Data inspection only: no provider, database, network, read/payment authority or semantic judge. */
export function gradeDeliverable(contractInput: unknown, snapshotInput: unknown) {
  const { contract, snapshot } = validateDeliverableInputs(contractInput, snapshotInput);
  const actualKeys = new Set(snapshot.bindings.map(binding => bindingKey({ ...binding, quoteSha256: deliverableSha256(binding.quote) })));
  const expectedKeys = new Set(contract.requiredBindings.map(bindingKey));
  const missingBindingCount = [...expectedKeys].filter(key => !actualKeys.has(key)).length;
  const unexpectedBindingCount = [...actualKeys].filter(key => !expectedKeys.has(key)).length;
  const bindingMismatch = missingBindingCount > 0 || unexpectedBindingCount > 0;
  const matchedTargetCount = new Set(contract.requiredBindings.filter(binding => actualKeys.has(bindingKey(binding))).map(binding => binding.claimIndex)).size;
  const paragraphs = snapshot.answer.split(/\r?\n\s*\r?\n/u);
  const absentExcerpts = snapshot.bindings.filter(binding => !paragraphs.some(paragraph =>
    paragraph.includes(excerptAsDelivered(binding.quote)) && paragraph.includes(`[${binding.marker}]`))).length;
  const wordCount = whitespaceWordCount(snapshot.answer);
  const bulletCount = topLevelBulletCount(snapshot.answer.slice(0, snapshot.bulletRegion.end));
  const checks: Record<string, DeliverableCheck> = {
    nonemptyAnswer: { status: snapshot.answer.trim() ? "PASS" : "FAIL", detail: "Recorded text presence only; does not establish an answered question." },
    retainedBindings: { status: bindingMismatch || absentExcerpts ? "FAIL" : "PASS",
      detail: `${snapshot.bindings.length} recorded public rows; ${missingBindingCount} missing bindings, ${unexpectedBindingCount} unexpected bindings, ${absentExcerpts} absent excerpt/marker pairs. No independent entailment or source-body verification.` },
    bulletCount: contract.format.bulletCount === undefined ? { status: "UNJUDGED", detail: "No bullet-count contract." }
      : { status: bulletCount === contract.format.bulletCount ? "PASS" : "FAIL", detail: `${bulletCount} unindented bullets; expected ${contract.format.bulletCount}.` },
    wordLimit: contract.format.maxWhitespaceWords === undefined ? { status: "UNJUDGED", detail: "No word-limit contract." }
      : { status: wordCount <= contract.format.maxWhitespaceWords ? "PASS" : "FAIL", detail: `${wordCount} full-answer whitespace tokens; maximum ${contract.format.maxWhitespaceWords}.` },
    language: { status: "UNJUDGED", detail: `Requested ${contract.requestedLanguage}; no language judge supplied.` },
    requiredFacts: { status: "UNJUDGED", detail: "Recorded target/quote identity is not semantic completeness or factual correctness." },
  };
  if (contract.version === 2) {
    checks.retainedTargetBindings = { status: matchedTargetCount === contract.targets.length ? "PASS" : "FAIL",
      detail: `${matchedTargetCount}/${contract.targets.length} declared targets have a matching retained qualifying binding. Absence is recorded provenance only, not an independent semantic completeness judgment.` };
    checks.sentenceCount = { status: "UNJUDGED", detail: contract.format.requestedSentenceCount === undefined
      ? "No sentence-count contract." : `${contract.format.requestedSentenceCount} sentences requested; no multilingual sentence/format judge supplied.` };
  }
  const deterministicContractPassed = !Object.values(checks).some(check => check.status === "FAIL");
  return { version: contract.version, id: contract.id, issues: contract.issues, kind: contract.kind,
    requestedLanguage: contract.requestedLanguage, provenance: snapshot.provenance,
    measured: { wordCount, bulletCount, retainedBindingCount: snapshot.bindings.length,
      targetCount: contract.targets.length, matchedTargetCount, missingBindingCount, unexpectedBindingCount,
      bulletRegion: snapshot.bulletRegion }, checks,
    deterministicContractPassed, outcome: deterministicContractPassed ? "UNJUDGED" as const : "FAIL" as const,
    deliverableAccepted: false as const };
}
