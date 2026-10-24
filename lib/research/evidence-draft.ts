import { z } from "zod";
import { literatureWorkspaceSchema, type LiteratureWorkspace } from "../papers/literature-workspace";
import { boundedPortableCopy } from "./bounded-portable-json";
import { referenceKey } from "./reference-export-core";
import { hasKnownSeedFingerprint } from "./seed-evidence-fingerprints";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { assertRelatedWorkStatementShape, RELATED_WORK_STATEMENT_KINDS, resolveRelatedWorkStatements } from "./related-work-statements";
import { assembleRelatedWorkThemes, type RelatedWorkAssembly } from "./related-work-generation";
import { relatedWorkReadingLists } from "./related-work-reading";
import { retainedPaperRecordUrl } from "./retained-paper-identity";
import { observedPdfTextScope, pdfTextScopeSchema, pdfTextScopeTruncated, type PdfTextScope } from "../web-research/pdf-text-scope";
import { observedHtmlSectionScope, htmlSectionScopeSchema, type HtmlSectionScope } from "../web-research/html-section-scope";

export const MAX_EVIDENCE_DRAFT_BYTES = 65_536;
const text = (max: number, min = 0) => z.string().min(min).max(max).refine(isWellFormedUtf16);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const url = z.string().max(2048).url().refine(isWellFormedUtf16).refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && !/[<>"\s\u0000-\u001f\u007f-\u009f]/u.test(value);
});
// Optional historical report metadata remains untrusted. Keep only an observed,
// internally consistent reading scope; unknown/malformed annotations supply no bounds.
const readingProvenance = z.unknown().optional().transform(value => {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (!fields.extraction || !("value" in fields.extraction)) return;
    if (fields.extraction.value === "html") {
      if (!fields.htmlSectionScope || !("value" in fields.htmlSectionScope) || !fields.truncated || !("value" in fields.truncated) || fields.truncated.value !== true) return;
      const scope = observedHtmlSectionScope(fields.htmlSectionScope.value);
      return scope ? { extraction: "html" as const, truncated: true as const, htmlSectionScope: scope } : undefined;
    }
    if (fields.extraction.value !== "pdf" || !fields.pdfTextScope || !("value" in fields.pdfTextScope)) return;
    const scope = observedPdfTextScope(fields.pdfTextScope.value);
    if (!scope || fields.truncated && (!("value" in fields.truncated)
      || typeof fields.truncated.value !== "boolean" || fields.truncated.value !== pdfTextScopeTruncated(scope))) return;
    return { extraction: "pdf" as const, pdfTextScope: scope };
  } catch { return; }
});
const identity = {
  marker: id, sourceId: text(200, 1), itemId: text(200, 1).optional(),
  itemTitle: text(1000).optional(), itemUrl: url.optional(), contentVersion: text(200).optional(),
  evidenceProvenance: z.literal("synthetic-demo").optional(),
  contentReceipt: z.object({ bodyHash: text(200).optional() }).strip().optional(),
  webProvenance: readingProvenance,
};
// Strip unrelated report fields. A caller-imported report is never authenticated by this parser.
export const evidenceDraftReportSchema = z.object({
  id, subClaims: z.array(text(4000)).max(64),
  citations: z.array(z.object(identity).strip()).max(64),
  evidence: z.array(z.object({ ...identity, claimIndex: z.number().int().min(0).max(63),
    claim: text(4000), quote: text(240, 1), qualifiesForAnswer: z.boolean().optional(),
    qualifiesForReward: z.boolean(),
  }).strip()).max(256).optional(),
}).strip();

const assessmentSchema = z.object({
  origin: z.literal("user-assessment"), reviewer: text(120, 1).refine(value => !!value.trim()), reviewedAt: z.string().datetime(),
  verdict: z.enum(["supported", "partly-supported", "not-found"]),
  claimText: text(4000), paperUrls: z.array(url).min(1).max(4), excerptIds: z.array(id).max(16),
  // These exact retained rows, rather than their nonsecurity IDs alone, bind an assessment.
  excerpts: z.array(z.object({ id, reportId: id, paperUrl: url, contentVersion: text(200, 1), quote: text(240, 1), readUrl: url.optional(),
    pdfTextScope: pdfTextScopeSchema.optional(), htmlSectionScope: htmlSectionScopeSchema.optional() }).strict()).max(16),
}).strict();
const claimSchema = z.object({ id, start: z.number().int().nonnegative(), end: z.number().int().positive(),
  paperUrls: z.array(url).min(1).max(4), excerptIds: z.array(id).max(16), assessment: assessmentSchema.optional(),
}).strict();
/** One author-written sentence. A paper it names must be cited with a selected retained excerpt. */
export const relatedWorkStatementSchema = z.object({ id, kind: z.enum(RELATED_WORK_STATEMENT_KINDS),
  text: text(600, 1).refine(value => !!value.trim()), paperUrls: z.array(url).max(8), excerptIds: z.array(id).max(16) }).strict();
export const evidenceDraftThemeSchema = z.object({ id, title: text(120, 1),
  authorNote: text(2000), excerptIds: z.array(id).max(32),
  statements: z.array(relatedWorkStatementSchema).max(24).optional() }).strict();
export const evidenceDraftRequestSchema = z.object({
  version: z.literal(1), scope: z.literal("private-evidence-draft"), workspace: literatureWorkspaceSchema,
  reports: z.array(evidenceDraftReportSchema).max(8), passage: text(12_000),
  claims: z.array(claimSchema).max(32), themes: z.array(evidenceDraftThemeSchema).max(16),
  readingStatuses: z.array(z.object({ paperUrl: url, status: z.enum(["unread", "unavailable"]), reason: text(300) }).strict()).max(50).optional(),
  assembly: z.discriminatedUnion("mode", [z.object({ mode: z.literal("append") }).strict(),
    z.object({ mode: z.literal("regenerate"), themeId: id }).strict()]).optional(),
}).strict();
export type EvidenceDraftRequest = z.infer<typeof evidenceDraftRequestSchema>;
export interface DraftExcerpt { id: string; reportId: string; paperUrl: string; contentVersion: string; quote: string; readUrl?: string; pdfTextScope?: PdfTextScope; htmlSectionScope?: HtmlSectionScope }
export const EVIDENCE_DRAFT_NOTICE = "Drafting aid. Read the papers and review the text yourself. Imported reports are caller-supplied; their origin, factual support and settlement are not authenticated here. No research, purchase or creator reward is started.";

/** Only Include bibliography/focus enters drafting; screening notes are not evidence. */
export function evidenceDraftWorkspace(workspace: LiteratureWorkspace): LiteratureWorkspace {
  return literatureWorkspaceSchema.parse({ ...workspace, entries: workspace.entries.filter(row => row.screening === "include")
    .map(row => ({ ...row, notes: "" })) });
}

export function parseEvidenceDraftRequest(value: unknown): EvidenceDraftRequest {
  const input = evidenceDraftRequestSchema.parse(boundedPortableCopy(value, MAX_EVIDENCE_DRAFT_BYTES));
  for (const entry of input.workspace.entries) url.parse(entry.paper.url);
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  if (!unique(input.reports.map(row => row.id)) || !unique(input.claims.map(row => row.id)) || !unique(input.themes.map(row => row.id)))
    throw new Error("Duplicate draft identifiers");
  for (const claim of input.claims) {
    const claimText = input.passage.slice(claim.start, claim.end);
    if (claim.end > input.passage.length || claim.start >= claim.end || !claimText.trim() || !isWellFormedUtf16(claimText)
      || !unique(claim.paperUrls) || !unique(claim.excerptIds)) throw new Error("Invalid exact claim span");
  }
  for (const theme of input.themes) if (!unique(theme.excerptIds)) throw new Error("Duplicate theme excerpts");
  assertRelatedWorkStatementShape(input.themes.flatMap(theme => theme.statements ?? []));
  return input;
}

/** Literal URL + source + item + version + marker + claim binding within the retained ledger.
 * An explicit same-version arXiv PDF may then map to its saved bibliography record.
 * No title similarity, DOI inference, cross-version substitution or semantic support inference. */
export function retainedDraftExcerpts(input: EvidenceDraftRequest): DraftExcerpt[] {
  return retainedDraftEvidence(input).map(row => row.excerpt);
}

/** Keep assembly context beside the exact row admitted by the shared gate.
 * Targets are internal context, never part of the portable excerpt/assessment. */
function retainedDraftEvidence(input: EvidenceDraftRequest) {
  const included = input.workspace.entries.filter(row => row.screening === "include").map(row => row.paper);
  const result = new Map<string, { excerpt: DraftExcerpt; target: string }>();
  for (const report of input.reports) {
    const syntheticMarkers = new Set([...report.citations, ...(report.evidence ?? [])]
      .filter(row => row.evidenceProvenance === "synthetic-demo" || hasKnownSeedFingerprint(row.itemTitle, row.itemUrl, row.contentReceipt?.bodyHash)).map(row => row.marker));
    for (const row of report.evidence ?? []) {
      if (!row.itemUrl || !row.itemId || !row.contentVersion?.trim()
        || syntheticMarkers.has(row.marker) || !(row.qualifiesForAnswer ?? row.qualifiesForReward)
        || !row.quote.trim() || report.subClaims[row.claimIndex] !== row.claim) continue;
      const citations = report.citations.filter(citation => citation.marker === row.marker);
      if (citations.length !== 1) continue;
      const citation = citations[0];
      if (citation.sourceId !== row.sourceId || citation.itemId !== row.itemId || citation.itemUrl !== row.itemUrl
        || citation.contentVersion !== row.contentVersion) continue;
      const paperUrl = retainedPaperRecordUrl(row.itemUrl, included);
      if (!paperUrl) continue;
      const scope = row.webProvenance?.pdfTextScope;
      const pdfTextScope = scope && citation.webProvenance?.pdfTextScope
        && JSON.stringify(scope) === JSON.stringify(citation.webProvenance.pdfTextScope) ? scope : undefined;
      const html = row.webProvenance?.htmlSectionScope;
      const htmlScope = html && citation.webProvenance?.htmlSectionScope
        && JSON.stringify(html) === JSON.stringify(citation.webProvenance.htmlSectionScope) ? html : undefined;
      const body = { reportId: report.id, paperUrl, contentVersion: row.contentVersion, quote: row.quote,
        ...(paperUrl !== row.itemUrl ? { readUrl: row.itemUrl } : {}) };
      const key = referenceKey(JSON.stringify({ ...body, sourceId: row.sourceId, itemId: row.itemId, marker: row.marker }), "excerpt");
      const previous = result.get(key), identity = { id: key, ...body };
      let retainedScope = pdfTextScope;
      let retainedHtml = htmlScope;
      if (previous) {
        const { pdfTextScope: priorScope, htmlSectionScope: priorHtml, ...priorIdentity } = previous.excerpt;
        if (JSON.stringify(priorIdentity) !== JSON.stringify(identity)) throw new Error("Excerpt identifier collision");
        // One quotation can occur under multiple targets. Its bounds are unknown
        // unless every admitted occurrence agrees; missing scope cannot be filled.
        retainedScope = priorScope && pdfTextScope && JSON.stringify(priorScope) === JSON.stringify(pdfTextScope) ? pdfTextScope : undefined;
        retainedHtml = priorHtml && htmlScope && JSON.stringify(priorHtml) === JSON.stringify(htmlScope) ? htmlScope : undefined;
      }
      // Reading metadata is assessment context, not a new quotation identity.
      const excerpt = { ...identity, ...(retainedScope ? { pdfTextScope: retainedScope } : {}), ...(retainedHtml ? { htmlSectionScope: retainedHtml } : {}) };
      result.set(key, { excerpt, target: row.claim });
    }
  }
  return [...result.values()];
}

export function buildEvidenceDraft(value: unknown) {
  const parsed = parseEvidenceDraftRequest(value), input = parsed.assembly ? assembleEvidenceDraftRequest(parsed, parsed.assembly) : parsed;
  const excerpts = retainedDraftExcerpts(input), reading = relatedWorkReadingLists(input, excerpts);
  const selected = (ids: readonly string[]) => ids.map(id => {
    const row = excerpts.find(row => row.id === id);
    if (!row) throw new Error("Selected excerpt is unavailable or changed");
    return row;
  });
  const claims = input.claims.map(claim => {
    const claimText = input.passage.slice(claim.start, claim.end), rows = selected(claim.excerptIds);
    if (rows.some(row => !claim.paperUrls.includes(row.paperUrl))) throw new Error("Claim excerpt cites a different exact work");
    const unavailable = claim.paperUrls.filter(paperUrl => !excerpts.some(row => row.paperUrl === paperUrl));
    const assessment = claim.assessment;
    const bound = assessment && assessment.claimText === claimText && JSON.stringify(assessment.paperUrls) === JSON.stringify(claim.paperUrls)
      && JSON.stringify(assessment.excerptIds) === JSON.stringify(claim.excerptIds) && JSON.stringify(assessment.excerpts) === JSON.stringify(rows);
    // An unavailable source cannot be classified as unsupported by a submitted judgment.
    const accepted = bound && unavailable.length === 0 && (assessment.verdict === "not-found" ? rows.length === 0 : rows.length > 0);
    return { id: claim.id, text: claimText, paperUrls: claim.paperUrls, excerpts: rows, unavailable,
      status: unavailable.length ? "source-unavailable" as const : accepted ? "user-assessed" as const : "assessment-pending" as const,
      ...(accepted ? { assessment } : {}), assessmentStale: !!assessment && !accepted,
      evidenceNotice: rows.length ? "Selected retained excerpts; semantic support remains a separate assessment." : "No supporting passage selected. This is not an exhaustive search or an unsupported verdict." };
  });
  const themes = input.themes.map(theme => ({ ...theme, excerpts: selected(theme.excerptIds),
    statements: resolveRelatedWorkStatements(theme.statements ?? [], selected) }));
  // Withheld statements are never exported, so their selections cite nothing.
  const citedUrls = [...new Set(themes.flatMap(theme => [...theme.excerpts,
    ...theme.statements.flatMap(row => row.status === "withheld" ? [] : row.excerpts)].map(row => row.paperUrl)))];
  const references = citedUrls.map(paperUrl => {
    const paper = input.workspace.entries.find(row => row.paper.url === paperUrl)!.paper;
    return { key: referenceKey(paperUrl, "keryxDraft"), paper };
  });
  if (new Set(references.map(row => row.key)).size !== references.length) throw new Error("Reference key collision");
  return { version: 1 as const, scope: "private-evidence-draft" as const, notice: EVIDENCE_DRAFT_NOTICE,
    origin: "caller-supplied-report" as const, title: input.workspace.title, question: input.workspace.question,
    passage: input.passage, excerpts, claims, themes, references, reading,
    ...(parsed.assembly ? { editableRequest: input } : {}),
    unread: input.workspace.entries.filter(row => row.screening === "include" && !excerpts.some(excerpt => excerpt.paperUrl === row.paper.url))
      .map(row => ({ paper: row.paper, status: "retained-excerpt-unavailable" as const })),
  };
}
export type EvidenceDraft = ReturnType<typeof buildEvidenceDraft>;

/** A one-shot assembly operation returns editable inputs, with the operation
 * removed. Rebuilding/exporting those inputs cannot overwrite subsequent edits. */
export function assembleEvidenceDraftRequest(value: unknown, operation: RelatedWorkAssembly): EvidenceDraftRequest {
  const input = parseEvidenceDraftRequest(value), retained = retainedDraftEvidence(input), excerpts = retained.map(row => row.excerpt);
  relatedWorkReadingLists(input, excerpts);
  const { assembly: _assembly, ...editable } = input;
  return parseEvidenceDraftRequest({ ...editable, themes: assembleRelatedWorkThemes(input, retained, operation) });
}

/** Replace one explicit theme; preserve every other theme and its author edits. */
export function replaceEvidenceDraftTheme(input: EvidenceDraftRequest, theme: z.infer<typeof evidenceDraftThemeSchema>): EvidenceDraftRequest {
  const parsed = evidenceDraftThemeSchema.parse(theme);
  if (!input.themes.some(row => row.id === parsed.id)) throw new Error("Unknown theme");
  return parseEvidenceDraftRequest({ ...input, themes: input.themes.map(row => row.id === parsed.id ? parsed : row) });
}
