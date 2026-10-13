import { z } from "zod";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { boundedPortableCopy } from "./bounded-portable-json";
import { claimComparisonText, draftClaimMarkers, impliesDifferentWork, splitDraftClaims, MAX_DRAFT_CLAIMS, type DraftClaimSpan } from "./draft-check-claims";
import { parseDraftReferences, type DraftReference } from "./draft-check-references";
import { DRAFT_CHECK_METHOD, lexicalSupport, prepareDraftSource, usesUnsegmentedScript, type DraftExcerptSpan, type LexicalDifference, type PreparedSource } from "./draft-check-support";
import { draftSourceIdentitySchema, draftSourceUrlSchema, draftWorkBinding, syntheticDraftIdentity, type DraftSourceIdentity } from "./draft-check-sources";

/** Private draft check, version 1: one stateless contract for the browser, API and MCP.
 * It compares each cited sentence with source text the caller supplies. It fetches,
 * buys, rewards and stores nothing, and never classifies an unsupplied source. */

export const MAX_DRAFT_CHECK_BYTES = 65_536;
export const MAX_DRAFT_SOURCE_CHARACTERS = 40_000;
const text = (max: number, min = 0) => z.string().min(min).max(max).refine(isWellFormedUtf16);

export const draftCheckRequestSchema = z.object({
  version: z.literal(1), scope: z.literal("private-draft-check"),
  passage: text(12_000, 1).refine(value => !!value.trim()),
  references: z.object({ format: z.enum(["bibtex", "ris", "list"]), text: text(24_000) }).strict(),
  sources: z.array(z.object({
    reference: text(140, 1),
    /** "partial" when the caller supplies an abstract, section or retained excerpts only. */
    coverage: z.enum(["full-text", "partial"]),
    text: text(MAX_DRAFT_SOURCE_CHARACTERS, 1).refine(value => !!value.trim()),
    identity: draftSourceIdentitySchema.optional(),
  }).strict()).max(32),
  /** Alternative READ bodies are suggestions only; they cannot repair written citations. */
  suggestions: z.array(z.object({ url: draftSourceUrlSchema, title: text(1000, 1),
    coverage: z.enum(["full-text", "partial"]), text: text(MAX_DRAFT_SOURCE_CHARACTERS, 1).refine(value => !!value.trim()),
    identity: draftSourceIdentitySchema,
  }).strict()).max(8).optional(),
  /** Optional caller-chosen exact spans; absent means one claim per sentence. */
  claims: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict()).max(MAX_DRAFT_CLAIMS).optional(),
}).strict();
export type DraftCheckRequest = z.infer<typeof draftCheckRequestSchema>;

export const DRAFT_CHECK_NOTICE = "Wording check, not semantic or expert review. Each verdict compares your sentence with source text you supplied and quotes that text exactly; read every excerpt before relying on it. Supplied text is not authenticated as the cited work. Keryx fetched, bought, rewarded and stored nothing for this check.";

export type DraftCitationVerdict = "supported" | "partly-supported" | "not-found" | "source-unavailable";
export type DraftClaimVerdict = DraftCitationVerdict | "not-checked";
export interface DraftCitationCheck {
  token: string;
  reference?: string;
  verdict: DraftCitationVerdict;
  /** Every verdict names exactly one of these evidence states. */
  evidence: "verbatim-excerpt" | "no-supporting-passage-found" | "source-unavailable";
  unavailableReason?: "source-text-not-supplied" | "reference-unresolved" | "reference-ambiguous" | "reference-year-differs" | "different-work" | "source-identity-unresolved" | "source-read-incomplete" | "synthetic-source";
  coverage?: "full-text" | "partial";
  sourceIdentity?: DraftSourceIdentity;
  excerpt?: DraftExcerptSpan;
  missingTerms?: string[];
  missingNumbers?: string[];
  /** The excerpt is tentative where the claim is stated plainly. */
  sourceTentative?: true;
  closest?: DraftExcerptSpan & { difference: LexicalDifference };
}
export type DraftCheckFlag =
  | { kind: "reference-unresolved"; reference: string; problem: NonNullable<DraftReference["problem"]> }
  | { kind: "reference-not-cited"; reference: string }
  | { kind: "citation-unresolved"; claim: string; token: string; problem: "unresolved" | "ambiguous" | "year-differs"; candidates?: string[] }
  | { kind: "possible-different-work"; claim: string; reference: string; impliedAuthor: string }
  | { kind: "source-different-work"; claim: string; reference: string; observedUrl: string };

function claimSpans(input: DraftCheckRequest, references: DraftReference[]): DraftClaimSpan[] {
  if (!input.claims) return splitDraftClaims(input.passage, references);
  let previousEnd = 0;
  return input.claims.map(span => {
    const slice = input.passage.slice(span.start, span.end);
    if (span.end > input.passage.length || span.start >= span.end || span.start < previousEnd || !slice.trim() || !isWellFormedUtf16(slice))
      throw new Error("Invalid exact claim span");
    previousEnd = span.end;
    return { ...span, markers: draftClaimMarkers(input.passage, span, references) };
  });
}

const RANK: Record<DraftCitationVerdict, number> = { "supported": 3, "partly-supported": 2, "not-found": 0, "source-unavailable": 1 };

export function parseDraftCheckRequest(value: unknown): DraftCheckRequest {
  const input = draftCheckRequestSchema.parse(boundedPortableCopy(value, MAX_DRAFT_CHECK_BYTES));
  if (new Set(input.sources.map(row => row.reference)).size !== input.sources.length) throw new Error("Duplicate source text");
  return input;
}

export function buildDraftCheck(value: unknown) {
  const input = parseDraftCheckRequest(value);
  const references = parseDraftReferences(input.references.format, input.references.text);
  const sources = new Map<string, { coverage: "full-text" | "partial"; prepared: PreparedSource; identity?: DraftSourceIdentity }>();
  for (const source of input.sources) {
    // Text for a work that is not in the list cannot be attributed to any citation.
    if (!references.some(row => row.key === source.reference && row.problem !== "duplicate-key")) throw new Error("Source text names an unknown reference");
    sources.set(source.reference, { coverage: source.coverage, prepared: prepareDraftSource(source.text), identity: source.identity });
  }
  const alternatives = (input.suggestions ?? []).map(row => {
    if (row.url !== row.identity.itemUrl) throw new Error("Suggestion identity changed");
    return { ...row, prepared: prepareDraftSource(row.text) };
  });
  const flags: DraftCheckFlag[] = references.filter(row => row.status === "unresolved")
    .map(row => ({ kind: "reference-unresolved" as const, reference: row.key, problem: row.problem! }));
  const cited = new Set<string>();
  const claims = claimSpans(input, references).map((span, index) => {
    const id = `claim${index + 1}`, claimText = input.passage.slice(span.start, span.end);
    const targets = span.markers.flatMap(marker => marker.targets.map(target => ({ marker, target })));
    const seen = new Set<string>(), citations: DraftCitationCheck[] = [];
    const comparison = claimComparisonText(input.passage, span);
    const unsegmented = usesUnsegmentedScript(comparison);
    for (const { marker, target } of targets) {
      const identity = target.reference ?? `?${target.token}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (!target.reference) {
        flags.push({ kind: "citation-unresolved", claim: id, token: target.token, problem: target.problem!, ...(target.candidates ? { candidates: target.candidates } : {}) });
        citations.push({ token: target.token, verdict: "source-unavailable", evidence: "source-unavailable",
          unavailableReason: target.problem === "ambiguous" ? "reference-ambiguous" : target.problem === "year-differs" ? "reference-year-differs" : "reference-unresolved" });
        continue;
      }
      cited.add(target.reference);
      const reference = references.find(row => row.key === target.reference)!;
      // Caller text cannot repair an unreadable or unidentified reference entry.
      if (reference.status === "unresolved") {
        citations.push({ token: target.token, reference: reference.key, verdict: "source-unavailable", evidence: "source-unavailable", unavailableReason: "reference-unresolved" });
        continue;
      }
      if (impliesDifferentWork(marker, reference))
        flags.push({ kind: "possible-different-work", claim: id, reference: reference.key, impliedAuthor: marker.impliedAuthor! });
      const source = sources.get(reference.key);
      // No supplied text means unavailable. It is never reported as unsupported.
      if (!source) { citations.push({ token: target.token, reference: reference.key, verdict: "source-unavailable", evidence: "source-unavailable", unavailableReason: "source-text-not-supplied" }); continue; }
      if (source.identity) {
        const binding = draftWorkBinding(reference, source.identity);
        const reason = syntheticDraftIdentity(source.identity) ? "synthetic-source"
          : binding === "different-work" ? "different-work" : binding === "unresolved" ? "source-identity-unresolved" : undefined;
        if (reason) {
          if (reason === "different-work") flags.push({ kind: "source-different-work", claim: id, reference: reference.key, observedUrl: source.identity.itemUrl });
          citations.push({ token: target.token, reference: reference.key, verdict: "source-unavailable", evidence: "source-unavailable", unavailableReason: reason });
          continue;
        }
      }
      if (unsegmented) continue;
      const support = lexicalSupport(comparison, source.prepared);
      // Bounded/abstract READs cannot establish an exhaustive negative for a work.
      if (source.identity && source.coverage === "partial" && support.verdict === "not-found") {
        citations.push({ token: target.token, reference: reference.key, verdict: "source-unavailable", evidence: "source-unavailable",
          unavailableReason: "source-read-incomplete", coverage: source.coverage, sourceIdentity: source.identity });
        continue;
      }
      citations.push({ token: target.token, reference: reference.key, verdict: support.verdict, coverage: source.coverage,
        ...(source.identity ? { sourceIdentity: source.identity } : {}),
        evidence: support.excerpt ? "verbatim-excerpt" : "no-supporting-passage-found",
        ...(support.excerpt ? { excerpt: support.excerpt } : {}), missingTerms: support.missingTerms, missingNumbers: support.missingNumbers,
        ...(support.sourceTentative ? { sourceTentative: true as const } : {}), ...(support.closest ? { closest: support.closest } : {}) });
    }
    const best = citations.reduce<DraftCitationVerdict | undefined>((current, row) => current === undefined || RANK[row.verdict] > RANK[current] ? row.verdict : current, undefined);
    const verdict: DraftClaimVerdict = !targets.length || (unsegmented && !citations.some(row => row.verdict === "source-unavailable")) || best === undefined ? "not-checked" : best;
    return { id, start: span.start, end: span.end, text: claimText, verdict,
      ...(verdict === "not-checked" ? { notCheckedReason: !targets.length ? "no-citation" as const : "script-without-word-spacing" as const } : {}),
      citations,
      suggestions: unsegmented ? [] : alternatives.flatMap(row => {
        if (syntheticDraftIdentity(row.identity)) return [];
        const support = lexicalSupport(comparison, row.prepared);
        return support.excerpt ? [{ kind: "suggestion" as const, url: row.url, title: row.title, verdict: support.verdict,
          coverage: row.coverage, excerpt: support.excerpt, sourceIdentity: row.identity }] : [];
      }) };
  });
  for (const reference of references) if (reference.status !== "unresolved" && !cited.has(reference.key)) flags.push({ kind: "reference-not-cited", reference: reference.key });
  const count = (verdict: DraftClaimVerdict) => claims.filter(row => row.verdict === verdict).length;
  return { version: 1 as const, scope: "private-draft-check" as const, method: DRAFT_CHECK_METHOD, notice: DRAFT_CHECK_NOTICE,
    origin: "caller-supplied-source-text" as const,
    references: references.map(row => ({ ...row, sourceText: sources.has(row.key) ? sources.get(row.key)!.coverage : "not-supplied" as const })),
    claims, flags,
    summary: { claims: claims.length, supported: count("supported"), partlySupported: count("partly-supported"), notFound: count("not-found"),
      sourceUnavailable: count("source-unavailable"), notChecked: count("not-checked") } };
}
export type DraftCheck = ReturnType<typeof buildDraftCheck>;
