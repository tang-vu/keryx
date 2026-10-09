import type { GatheredContent, ProposedEvidence } from "./reasoning-engine";
import type { QuoteOption } from "./quote-options";
import type { EvidenceSpan } from "./evidence-span";
import { completeEvidenceSpans } from "./evidence-span";
import { sourceHtmlLayout, sourceTextBlocks } from "./source-text-blocks";
import { visibleEnumerationKind } from "./enumerated-context";
import type { CitedStatement } from "../agent/cited-statements";
import type { EvidenceRecord } from "../types";
import type { HtmlTextLayout } from "../web-research/html-text-layout";

/** Structural presentation metadata only. No serializable evidence or payment capability. */
interface ItemProof {
  key: string;
  source: GatheredContent;
  layout: HtmlTextLayout;
  identity: string;
  start: number;
  end: number;
  quote: string;
}
const optionProofs = new WeakMap<QuoteOption, ItemProof>();
const ambiguousOptions = new WeakSet<QuoteOption>();
const spanProofs = new WeakMap<EvidenceSpan, ItemProof>();
const statementProofs = new WeakMap<CitedStatement, { item: ItemProof; snapshot: string }>();
function identity(value: Pick<EvidenceRecord, "marker" | "sourceId" | "itemId" | "itemUrl" | "contentVersion">): string {
  return JSON.stringify([value.marker, value.sourceId, value.itemId, value.itemUrl, value.contentVersion]);
}
function validSource(proof: ItemProof): boolean {
  const source = proof.source, layout = sourceHtmlLayout(source);
  return Boolean(layout && layout === proof.layout && !layout.limited && !source.webProvenance?.truncated &&
    identity(source) === proof.identity && source.text.slice(proof.start, proof.end) === proof.quote);
}
function matchesEvidence(proof: ItemProof, statement: CitedStatement, evidence: readonly EvidenceRecord[]): boolean {
  const rows = evidence.filter(item => item.claimIndex === statement.claimIndex && item.marker === statement.marker &&
    item.quote === statement.quote && (item.qualifiesForAnswer ?? item.qualifiesForReward));
  return rows.length > 0 && rows.every(row => identity(row) === proof.identity);
}

/** Called only for the ordinary opt-in menu after exact quote/context validation.
 * A whole-item alternative must actually survive the existing 64-option cap.
 * Different sentences can share it; no quote, context, ID or cap is changed.
 */
export function observeQuotePresentationItems(options: QuoteOption[], gathered: GatheredContent[]): void {
  for (const source of gathered) {
    const layout = sourceHtmlLayout(source);
    if (!layout || layout.limited || source.webProvenance?.truncated || !source.itemId || !source.itemUrl ||
        !source.contentVersion || source.text.length > 60000) continue;
    const candidates = options.filter(option => option.marker === source.marker && option.sourceId === source.sourceId &&
      option.itemUrl === source.itemUrl && option.contentVersion === source.contentVersion);
    if (!candidates.length) continue;
    const spans = completeEvidenceSpans(source);
    const blocks = sourceTextBlocks(source.text, "html", layout);
    for (const outer of candidates) {
      if (outer.text.length > 240 || !visibleEnumerationKind(outer.text) ||
          source.text.slice(outer.start, outer.end) !== outer.text ||
          layout.preformatted.some(region => region.start < outer.end && region.end > outer.start)) continue;
      const block = blocks.find(region => region.start <= outer.start && region.end >= outer.end);
      if (!block || source.text.slice(block.start, block.end).trim() !== outer.text) continue;
      const contained = spans.filter(span => span.start >= outer.start && span.end <= outer.end);
      if (contained.length < 2 || contained[0].start !== outer.start || contained.at(-1)!.end !== outer.end) continue;
      const sourceIdentity = identity(source);
      const key = JSON.stringify([sourceIdentity, layout.textSha256, outer.start, outer.end]);
      for (const option of candidates) {
        if (ambiguousOptions.has(option) || option.start < outer.start || option.end > outer.end ||
            source.text.slice(option.start, option.end) !== option.text) continue;
        const previous = optionProofs.get(option);
        // Refuse overlapping/ambiguous block proposals rather than picking a parent.
        if (previous && previous.key !== key) {
          optionProofs.delete(option);
          ambiguousOptions.add(option);
          continue;
        }
        optionProofs.set(option, Object.freeze({ key, source, layout, identity: sourceIdentity,
          start: option.start, end: option.end, quote: option.text }));
      }
    }
  }
}

/** The exact private span object survives ordinary review's shallow projection.
 * A JSON copy, forged numeric offsets or copied quote option has no membership.
 */
export function bindQuotePresentationSpan(option: QuoteOption, span: EvidenceSpan): void {
  const proof = optionProofs.get(option);
  if (proof && option.marker === proof.source.marker && option.sourceId === proof.source.sourceId &&
      option.itemUrl === proof.source.itemUrl && option.contentVersion === proof.source.contentVersion &&
      span.start === proof.start && span.end === proof.end && option.text === proof.quote && validSource(proof))
    spanProofs.set(span, proof);
}

/** Invoke only after existing excerpt/statement admission; this cannot admit a sentence. */
export function retainStatementPresentationItem(proposal: ProposedEvidence, statement: CitedStatement,
  evidence: EvidenceRecord[]): void {
  const proof = proposal.quoteSpan && spanProofs.get(proposal.quoteSpan);
  if (!proof || proposal.quoteSpan!.start !== proof.start || proposal.quoteSpan!.end !== proof.end ||
      proposal.quote !== proof.quote || statement.quote !== proof.quote || statement.marker !== proof.source.marker ||
      statement.claimIndex !== proposal.claimIndex || !validSource(proof)) return;
  if (!matchesEvidence(proof, statement, evidence)) return;
  statementProofs.set(statement, Object.freeze({ item: proof, snapshot: JSON.stringify(statement) }));
}

export function statementPresentationItem(statement: CitedStatement, evidence: readonly EvidenceRecord[]): string | undefined {
  const proof = statementProofs.get(statement);
  return proof && proof.snapshot === JSON.stringify(statement) && validSource(proof.item) &&
    matchesEvidence(proof.item, statement, evidence) ? proof.item.key : undefined;
}
