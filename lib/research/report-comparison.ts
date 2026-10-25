import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { prepareReceiptIntegrity } from "../receipt-integrity-core";
import { browserSha256 } from "../browser-receipt-integrity";
import { RESEARCH_RECEIPT_SCHEMA } from "../research-receipt-types";
import { observedPdfTextScope, pdfTextScopeTruncated, type PdfTextScope } from "../web-research/pdf-text-scope";
import { observedHtmlSectionScope, type HtmlSectionScope } from "../web-research/html-section-scope";
import { boundedPortableCopy } from "./bounded-portable-json";
import { hasKnownSeedFingerprint } from "./seed-evidence-fingerprints";

export const MAX_COMPARISON_RECEIPT_BYTES = 524_288;
export const MAX_COMPARISON_TARGETS = 256;
export const REPORT_COMPARISON_NOTICE = "Local inspection of caller-supplied receipts. Matching the recorded payload checksum checks consistency, not origin, factual support, settlement or improvement. Counts describe retained excerpt rows, not independent sources. No research or purchase is started.";
export type ComparisonErrorCode = "input-too-large" | "invalid-receipt" | "unsupported-report" | "invalid-target-matches";
export class ReportComparisonError extends Error {
  constructor(public readonly code: ComparisonErrorCode) { super(code); this.name = "ReportComparisonError"; }
}

export interface ComparisonReadContext {
  extraction?: "html" | "text" | "pdf";
  truncated?: boolean;
  retrievedAt?: string;
  normalizedBodyHash?: string;
  contentBodyHash?: string;
  pdfTextScope?: PdfTextScope;
  htmlSectionScope?: HtmlSectionScope;
  clippingConflict?: true;
  evidenceScope?: "paper-text" | "abstract-page" | "publisher-page";
  deliveryKind?: "full_text" | "excerpt" | "abstract" | "metadata_only";
}
export interface ComparisonExcerpt {
  marker: string; sourceId: string; sourceName: string; quote: string;
  itemId?: string; itemTitle?: string; itemUrl?: string; contentVersion?: string;
  illustrative: boolean; context: ComparisonReadContext;
}
export interface ComparisonTarget {
  claimIndex: number; claim: string; excerpts: ComparisonExcerpt[];
  ledgerAvailable: boolean; excludedRows: number;
}
export interface ComparisonReport {
  digest: string; id: string | null; question: string | null; answer: string | null; createdAt: string | null;
  ledgerAvailable: boolean; targets: ComparisonTarget[];
}
export interface TargetMatch { beforeClaimIndex: number; afterClaimIndex: number }
export type ComparisonState = "same-recorded-excerpts" | "read-context-changed" | "recorded-excerpts-changed"
  | "no-inspectable-excerpts" | "target-before-only" | "target-after-only" | "comparison-unavailable";
export interface ComparedTarget {
  before: ComparisonTarget | null; after: ComparisonTarget | null;
  match: "exact-target-text" | "user-selected" | "unmatched";
  state: ComparisonState;
  added: ComparisonExcerpt[]; removed: ComparisonExcerpt[];
  unchanged: Array<{ before: ComparisonExcerpt; after: ComparisonExcerpt }>;
  contextChanged: Array<{ before: ComparisonExcerpt; after: ComparisonExcerpt }>;
}
export interface ReportComparison {
  format: "keryx-report-comparison-v1"; notice: string; order: "caller-selected";
  availability: "complete" | "partial" | "unavailable";
  before: ComparisonReport; after: ComparisonReport; targets: ComparedTarget[];
  sameReceipt: boolean; questionChanged: boolean | null; answerChanged: boolean | null;
  summary: { comparableTargets: number; changedTargets: number; addedRows: number; removedRows: number;
    contextChangedRows: number; unknownTargets: number; illustrativeRows: number };
}

const text = z.string().max(4096);
const identity = {
  marker: text.min(1), sourceId: text.min(1), sourceName: text.optional().default(""),
  itemId: text.optional(), itemTitle: text.optional(), itemUrl: text.optional(), contentVersion: text.optional(),
  evidenceProvenance: z.literal("synthetic-demo").optional(), webProvenance: z.unknown().optional(),
  contentReceipt: z.unknown().optional(), scholarly: z.unknown().optional(), publicDeliveryKind: z.unknown().optional(),
};
const citationSchema = z.object(identity);
const evidenceSchema = z.object({ ...identity, quote: z.string().max(240),
  qualifiesForAnswer: z.boolean().optional(), qualifiesForReward: z.boolean() });
const claimSchema = z.object({ claimIndex: z.number().int().min(0).max(MAX_COMPARISON_TARGETS - 1),
  claim: text.min(1), evidence: z.array(z.unknown()).max(256).optional() });
const receiptViewSchema = z.object({ payload: z.object({ schema: z.literal(RESEARCH_RECEIPT_SCHEMA),
  dispatch: z.object({ id: text.optional(), question: z.string().max(32_768).optional(),
    answer: z.string().max(131_072).optional(), createdAt: z.string().max(80).optional() }),
  citations: z.array(z.unknown()).max(64).optional(), claims: z.array(claimSchema).max(MAX_COMPARISON_TARGETS).optional(),
}) });
const matchesSchema = z.array(z.object({ beforeClaimIndex: z.number().int().min(0).max(MAX_COMPARISON_TARGETS - 1),
  afterClaimIndex: z.number().int().min(0).max(MAX_COMPARISON_TARGETS - 1) }).strict()).max(MAX_COMPARISON_TARGETS);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function recordedHash(value: unknown): string | undefined {
  return typeof value === "string" && /^(?:sha256:)?[a-f0-9]{64}$/u.test(value) ? value : undefined;
}
function readContext(row: z.infer<typeof evidenceSchema>): ComparisonReadContext {
  const web = record(row.webProvenance), scholarly = record(row.scholarly), context: ComparisonReadContext = {};
  if (web.extraction === "html" || web.extraction === "text" || web.extraction === "pdf") context.extraction = web.extraction;
  if (typeof web.truncated === "boolean") context.truncated = web.truncated;
  if (typeof web.retrievedAt === "string" && web.retrievedAt.length <= 80) context.retrievedAt = web.retrievedAt;
  const normalized = recordedHash(web.normalizedBodyHash), body = recordedHash(record(row.contentReceipt).bodyHash);
  if (normalized) context.normalizedBodyHash = normalized;
  if (body) context.contentBodyHash = body;
  const pdf = context.extraction === "pdf" ? observedPdfTextScope(web.pdfTextScope) : undefined;
  const html = context.extraction === "html" && context.truncated ? observedHtmlSectionScope(web.htmlSectionScope) : undefined;
  if (pdf) {
    context.pdfTextScope = pdf;
    if (context.truncated !== undefined && context.truncated !== pdfTextScopeTruncated(pdf)) context.clippingConflict = true;
  }
  if (html) context.htmlSectionScope = html;
  if (scholarly.evidenceScope === "paper-text" || scholarly.evidenceScope === "abstract-page" || scholarly.evidenceScope === "publisher-page")
    context.evidenceScope = scholarly.evidenceScope;
  const delivery = row.publicDeliveryKind ?? record(row.contentReceipt).deliveryKind;
  if (delivery === "full_text" || delivery === "excerpt" || delivery === "abstract" || delivery === "metadata_only") context.deliveryKind = delivery;
  return context;
}
function synthetic(row: z.infer<typeof citationSchema>): boolean {
  return row.evidenceProvenance === "synthetic-demo" || hasKnownSeedFingerprint(row.itemTitle, row.itemUrl,
    typeof record(row.contentReceipt).bodyHash === "string" ? record(row.contentReceipt).bodyHash as string : undefined);
}

async function inspectedReport(input: string): Promise<ComparisonReport> {
  if (typeof input !== "string") throw new ReportComparisonError("invalid-receipt");
  if (input.length > MAX_COMPARISON_RECEIPT_BYTES || new TextEncoder().encode(input).length > MAX_COMPARISON_RECEIPT_BYTES)
    throw new ReportComparisonError("input-too-large");
  let value: unknown;
  try { value = boundedPortableCopy(JSON.parse(input.replace(/^\uFEFF/u, "")), MAX_COMPARISON_RECEIPT_BYTES); }
  catch { throw new ReportComparisonError("invalid-receipt"); }
  const prepared = prepareReceiptIntegrity(value);
  if (!prepared.ok) throw new ReportComparisonError("invalid-receipt");
  try {
    if (await browserSha256(prepared.canonical) !== prepared.actualDigest) throw new Error();
  } catch { throw new ReportComparisonError("invalid-receipt"); }
  const parsed = receiptViewSchema.safeParse(value);
  if (!parsed.success) throw new ReportComparisonError("unsupported-report");
  const payload = parsed.data.payload, claims = payload.claims ?? [];
  if (new Set(claims.map(row => row.claimIndex)).size !== claims.length) throw new ReportComparisonError("unsupported-report");
  const candidates = (payload.citations ?? []).map(row => citationSchema.safeParse(row));
  const citations = candidates.flatMap(row => row.success ? [row.data] : []);
  const parsedEvidence = claims.map(claim => (claim.evidence ?? []).map(row => evidenceSchema.safeParse(row)));
  const demoMarkers = new Set([...citations.filter(synthetic).map(row => row.marker),
    ...parsedEvidence.flat().flatMap(row => row.success && synthetic(row.data) ? [row.data.marker] : [])]);
  const targets = claims.map((claim, index): ComparisonTarget => {
    const rows = parsedEvidence[index], excerpts: ComparisonExcerpt[] = [];
    for (const row of rows) {
      if (!row.success) continue;
      const item = row.data, illustrative = demoMarkers.has(item.marker);
      if (!(item.qualifiesForAnswer ?? item.qualifiesForReward) && !illustrative || !item.quote.trim()) continue;
      if (!citations.some(c => c.marker === item.marker && c.sourceId === item.sourceId && c.itemId === item.itemId
        && c.itemUrl === item.itemUrl && c.contentVersion === item.contentVersion)) continue;
      excerpts.push({ marker: item.marker, sourceId: item.sourceId, sourceName: item.sourceName, quote: item.quote,
        ...(item.itemId !== undefined ? { itemId: item.itemId } : {}), ...(item.itemTitle !== undefined ? { itemTitle: item.itemTitle } : {}),
        ...(item.itemUrl !== undefined ? { itemUrl: item.itemUrl } : {}), ...(item.contentVersion !== undefined ? { contentVersion: item.contentVersion } : {}),
        illustrative, context: readContext(item) });
    }
    return { claimIndex: claim.claimIndex, claim: claim.claim, excerpts,
      ledgerAvailable: claim.evidence !== undefined && payload.citations !== undefined && candidates.every(row => row.success) && rows.every(row => row.success),
      excludedRows: (claim.evidence?.length ?? 0) - excerpts.length };
  });
  const dispatch = payload.dispatch;
  return { digest: prepared.actualDigest, id: dispatch.id ?? null, question: dispatch.question ?? null,
    answer: dispatch.answer ?? null, createdAt: dispatch.createdAt ?? null, ledgerAvailable: payload.claims !== undefined,
    targets: targets.sort((a, b) => a.claimIndex - b.claimIndex) };
}

function contentKey(row: ComparisonExcerpt): string {
  return canonicalJson([row.sourceId, row.itemId ?? null, row.itemUrl ?? null, row.contentVersion ?? null, row.quote]);
}
function contextKey(row: ComparisonExcerpt): string {
  // A new retrieval timestamp alone does not change the quote, version or read
  // boundary. Both timestamps remain available in the paired original rows.
  const { retrievedAt: _retrievedAt, ...context } = row.context;
  return canonicalJson([row.sourceName, row.itemTitle ?? null, row.illustrative, context]);
}
function compareTarget(before: ComparisonTarget | null, after: ComparisonTarget | null, match: ComparedTarget["match"],
  completeTargets: boolean): ComparedTarget {
  const result: ComparedTarget = { before, after, match, state: "comparison-unavailable", added: [], removed: [], unchanged: [], contextChanged: [] };
  if (!before || !after) {
    if (completeTargets) result.state = before ? "target-before-only" : "target-after-only";
    return result;
  }
  if (!before.ledgerAvailable || !after.ledgerAvailable) return result;
  const beforeRows = before.excerpts.map(row => ({ row, key: contentKey(row), context: contextKey(row) }));
  const afterRows = after.excerpts.map(row => ({ row, key: contentKey(row), context: contextKey(row) }));
  const used = new Set<number>(), pending = [] as typeof beforeRows;
  for (const old of beforeRows) {
    const index = afterRows.findIndex((next, index) => !used.has(index) && next.key === old.key && next.context === old.context);
    if (index >= 0) { used.add(index); result.unchanged.push({ before: old.row, after: afterRows[index].row }); }
    else pending.push(old);
  }
  for (const old of pending) {
    const index = afterRows.findIndex((next, index) => !used.has(index) && next.key === old.key);
    if (index >= 0) { used.add(index); result.contextChanged.push({ before: old.row, after: afterRows[index].row }); }
    else result.removed.push(old.row);
  }
  result.added = afterRows.filter((_, index) => !used.has(index)).map(item => item.row);
  result.state = result.added.length || result.removed.length ? "recorded-excerpts-changed" : result.contextChanged.length
    ? "read-context-changed" : result.unchanged.length ? "same-recorded-excerpts" : "no-inspectable-excerpts";
  return result;
}

/** One engine for browser memory, CLI and local stdio. No caller-provided validity
 * assertion, receipt URL, file path, server digest, model or payment capability. */
export async function compareSavedResearch(input: { before: string; after: string; matches?: TargetMatch[] }): Promise<ReportComparison> {
  const [before, after] = await Promise.all([inspectedReport(input.before), inspectedReport(input.after)]);
  const counts = (targets: ComparisonTarget[]) => {
    const result = new Map<string, number>();
    for (const target of targets) result.set(target.claim, (result.get(target.claim) ?? 0) + 1);
    return result;
  };
  const oldCounts = counts(before.targets), newCounts = counts(after.targets);
  const inferred = before.targets.flatMap(old => oldCounts.get(old.claim) === 1 && newCounts.get(old.claim) === 1
    ? [{ beforeClaimIndex: old.claimIndex, afterClaimIndex: after.targets.find(next => next.claim === old.claim)!.claimIndex }] : []);
  const parsedMatches = matchesSchema.safeParse(input.matches ?? inferred);
  if (!parsedMatches.success) throw new ReportComparisonError("invalid-target-matches");
  const matches = parsedMatches.data;
  if (new Set(matches.map(pair => pair.beforeClaimIndex)).size !== matches.length
    || new Set(matches.map(pair => pair.afterClaimIndex)).size !== matches.length
    || matches.some(pair => !before.targets.some(row => row.claimIndex === pair.beforeClaimIndex)
      || !after.targets.some(row => row.claimIndex === pair.afterClaimIndex))) throw new ReportComparisonError("invalid-target-matches");
  const completeTargets = before.ledgerAvailable && after.ledgerAvailable;
  const targets = before.targets.map(old => {
    const pair = matches.find(pair => pair.beforeClaimIndex === old.claimIndex);
    const next = pair ? after.targets.find(row => row.claimIndex === pair.afterClaimIndex)! : null;
    const exact = next && old.claim === next.claim && oldCounts.get(old.claim) === 1 && newCounts.get(old.claim) === 1;
    return compareTarget(old, next, next ? exact ? "exact-target-text" : "user-selected" : "unmatched", completeTargets);
  });
  for (const next of after.targets.filter(next => !matches.some(pair => pair.afterClaimIndex === next.claimIndex)))
    targets.push(compareTarget(null, next, "unmatched", completeTargets));
  const changed = new Set<ComparisonState>(["recorded-excerpts-changed", "read-context-changed"]);
  const availability = !completeTargets ? "unavailable" : [...before.targets, ...after.targets].some(target => !target.ledgerAvailable) ? "partial" : "complete";
  return { format: "keryx-report-comparison-v1", notice: REPORT_COMPARISON_NOTICE, order: "caller-selected", availability, before, after, targets,
    sameReceipt: before.digest === after.digest,
    questionChanged: before.question === null || after.question === null ? null : before.question !== after.question,
    answerChanged: before.answer === null || after.answer === null ? null : before.answer !== after.answer,
    summary: { comparableTargets: targets.filter(row => row.before && row.after && row.state !== "comparison-unavailable").length,
      changedTargets: targets.filter(row => changed.has(row.state)).length,
      addedRows: targets.reduce((sum, row) => sum + row.added.length, 0), removedRows: targets.reduce((sum, row) => sum + row.removed.length, 0),
      contextChangedRows: targets.reduce((sum, row) => sum + row.contextChanged.length, 0),
      unknownTargets: targets.filter(row => row.state === "comparison-unavailable").length,
      illustrativeRows: [...before.targets, ...after.targets].reduce((sum, target) => sum + target.excerpts.filter(row => row.illustrative).length, 0) } };
}
