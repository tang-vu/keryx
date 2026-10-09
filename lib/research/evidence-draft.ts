import { z } from "zod";
import { literatureWorkspaceSchema, type LiteratureWorkspace } from "../papers/literature-workspace";
import { boundedPortableCopy } from "./bounded-portable-json";
import { referenceKey } from "./reference-export-core";
import { hasKnownSeedFingerprint } from "./seed-evidence-fingerprints";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";

export const MAX_EVIDENCE_DRAFT_BYTES = 65_536;
const text = (max: number, min = 0) => z.string().min(min).max(max).refine(isWellFormedUtf16);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const url = z.string().max(2048).url().refine(isWellFormedUtf16).refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && !/[<>"\s\u0000-\u001f\u007f-\u009f]/u.test(value);
});
const identity = {
  marker: id, sourceId: text(200, 1), itemId: text(200, 1).optional(),
  itemTitle: text(1000).optional(), itemUrl: url.optional(), contentVersion: text(200).optional(),
  evidenceProvenance: z.literal("synthetic-demo").optional(),
  contentReceipt: z.object({ bodyHash: text(200).optional() }).strip().optional(),
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
  excerpts: z.array(z.object({ id, reportId: id, paperUrl: url, contentVersion: text(200, 1), quote: text(240, 1) }).strict()).max(16),
}).strict();
const claimSchema = z.object({ id, start: z.number().int().nonnegative(), end: z.number().int().positive(),
  paperUrls: z.array(url).min(1).max(4), excerptIds: z.array(id).max(16), assessment: assessmentSchema.optional(),
}).strict();
export const evidenceDraftThemeSchema = z.object({ id, title: text(120, 1),
  authorNote: text(2000), excerptIds: z.array(id).max(32) }).strict();
export const evidenceDraftRequestSchema = z.object({
  version: z.literal(1), scope: z.literal("private-evidence-draft"), workspace: literatureWorkspaceSchema,
  reports: z.array(evidenceDraftReportSchema).max(8), passage: text(12_000),
  claims: z.array(claimSchema).max(32), themes: z.array(evidenceDraftThemeSchema).max(16),
}).strict();
export type EvidenceDraftRequest = z.infer<typeof evidenceDraftRequestSchema>;
export interface DraftExcerpt { id: string; reportId: string; paperUrl: string; contentVersion: string; quote: string }
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
    if (claim.end > input.passage.length || claim.start >= claim.end || !input.passage.slice(claim.start, claim.end).trim()
      || !unique(claim.paperUrls) || !unique(claim.excerptIds)) throw new Error("Invalid exact claim span");
  }
  for (const theme of input.themes) if (!unique(theme.excerptIds)) throw new Error("Duplicate theme excerpts");
  return input;
}

/** Exact URL + source + item + version + marker + claim binding from the retained ledger.
 * No title similarity, DOI inference, cross-version substitution or semantic support inference. */
export function retainedDraftExcerpts(input: EvidenceDraftRequest): DraftExcerpt[] {
  const included = new Set(input.workspace.entries.filter(row => row.screening === "include").map(row => row.paper.url));
  const result = new Map<string, DraftExcerpt>();
  for (const report of input.reports) {
    const syntheticMarkers = new Set([...report.citations, ...(report.evidence ?? [])]
      .filter(row => row.evidenceProvenance === "synthetic-demo" || hasKnownSeedFingerprint(row.itemTitle, row.itemUrl, row.contentReceipt?.bodyHash)).map(row => row.marker));
    for (const row of report.evidence ?? []) {
      if (!row.itemUrl || !included.has(row.itemUrl) || !row.itemId || !row.contentVersion?.trim()
        || syntheticMarkers.has(row.marker) || !(row.qualifiesForAnswer ?? row.qualifiesForReward)
        || !row.quote.trim() || report.subClaims[row.claimIndex] !== row.claim) continue;
      const citations = report.citations.filter(citation => citation.marker === row.marker);
      if (citations.length !== 1) continue;
      const citation = citations[0];
      if (citation.sourceId !== row.sourceId || citation.itemId !== row.itemId || citation.itemUrl !== row.itemUrl
        || citation.contentVersion !== row.contentVersion) continue;
      const body = { reportId: report.id, paperUrl: row.itemUrl, contentVersion: row.contentVersion, quote: row.quote };
      const key = referenceKey(JSON.stringify({ ...body, sourceId: row.sourceId, itemId: row.itemId, marker: row.marker }), "excerpt");
      const excerpt = { id: key, ...body };
      if (result.has(key) && JSON.stringify(result.get(key)) !== JSON.stringify(excerpt)) throw new Error("Excerpt identifier collision");
      result.set(key, excerpt);
    }
  }
  return [...result.values()];
}

export function buildEvidenceDraft(value: unknown) {
  const input = parseEvidenceDraftRequest(value), excerpts = retainedDraftExcerpts(input);
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
  const themes = input.themes.map(theme => ({ ...theme, excerpts: selected(theme.excerptIds) }));
  const citedUrls = [...new Set(themes.flatMap(theme => theme.excerpts.map(row => row.paperUrl)))];
  const references = citedUrls.map(paperUrl => {
    const paper = input.workspace.entries.find(row => row.paper.url === paperUrl)!.paper;
    return { key: referenceKey(paperUrl, "keryxDraft"), paper };
  });
  if (new Set(references.map(row => row.key)).size !== references.length) throw new Error("Reference key collision");
  return { version: 1 as const, scope: "private-evidence-draft" as const, notice: EVIDENCE_DRAFT_NOTICE,
    origin: "caller-supplied-report" as const, title: input.workspace.title, question: input.workspace.question,
    passage: input.passage, excerpts, claims, themes, references,
    unread: input.workspace.entries.filter(row => row.screening === "include" && !excerpts.some(excerpt => excerpt.paperUrl === row.paper.url))
      .map(row => ({ paper: row.paper, status: "retained-excerpt-unavailable" as const })),
  };
}
export type EvidenceDraft = ReturnType<typeof buildEvidenceDraft>;

/** Replace one explicit theme; preserve every other theme and its author edits. */
export function replaceEvidenceDraftTheme(input: EvidenceDraftRequest, theme: z.infer<typeof evidenceDraftThemeSchema>): EvidenceDraftRequest {
  const parsed = evidenceDraftThemeSchema.parse(theme);
  if (!input.themes.some(row => row.id === parsed.id)) throw new Error("Unknown theme");
  return parseEvidenceDraftRequest({ ...input, themes: input.themes.map(row => row.id === parsed.id ? parsed : row) });
}
