import { SEED_EVIDENCE_FINGERPRINTS } from "./seed-evidence-fingerprints";
import type { QueryRun, SourceItemIdentity } from "../types";

export const SYNTHETIC_EVIDENCE_NOTICE = "Illustrative demo content: synthetic sources and measurements are not factual research evidence. Source provenance and payment status are separate; inspect the receipt for settled, pending or simulated payments. Settlement does not authenticate a source's claims.";

export function hasKnownSyntheticFingerprint(identity: Partial<SourceItemIdentity>): boolean {
  return !!identity.contentReceipt?.bodyHash && SEED_EVIDENCE_FINGERPRINTS.some(fingerprint =>
    fingerprint.itemTitle === identity.itemTitle && fingerprint.itemUrl === identity.itemUrl &&
    fingerprint.bodyHash === identity.contentReceipt?.bodyHash);
}

/** Public read projection; retain the archived prose and money, demote its factual authority. */
export function demoteSyntheticEvidence(run: QueryRun): QueryRun {
  const mark = <T extends Partial<SourceItemIdentity>>(item: T): T => hasKnownSyntheticFingerprint(item)
    ? { ...item, evidenceProvenance: "synthetic-demo" } : item;
  run = { ...run, citations: run.citations.map(mark), decisions: run.decisions.map(mark),
    ...(run.evidence ? { evidence: run.evidence.map(mark) } : {}) };
  const synthetic = new Set([
    ...run.citations.filter(c => c.evidenceProvenance === "synthetic-demo").map(c => c.marker),
    ...(run.evidence ?? []).filter(item => item.evidenceProvenance === "synthetic-demo").map(item => item.marker),
  ]);
  const containsDemo = synthetic.size > 0 || run.decisions.some(d => d.evidenceProvenance === "synthetic-demo") ||
    (run.evidence ?? []).some(e => e.evidenceProvenance === "synthetic-demo");
  if (!containsDemo) return run;
  const evidence = run.evidence?.map(item => item.evidenceProvenance === "synthetic-demo" || synthetic.has(item.marker)
    ? { ...item, evidenceProvenance: "synthetic-demo" as const, qualifiesForAnswer: false, qualifiesForReward: false, support: 0 } : item);
  const claimCoverage = run.claimCoverage?.map(claim => {
    const coveredBy = claim.coveredBy.filter(marker => !synthetic.has(marker));
    const factual = (evidence ?? []).filter(item => item.claimIndex === claim.claimIndex &&
      item.evidenceProvenance !== "synthetic-demo" && (item.qualifiesForAnswer ?? item.qualifiesForReward));
    return { ...claim, coveredBy, coverage: Math.min(claim.coverage, Math.max(0, ...factual.map(item => item.support))) };
  });
  return { ...run, evidence, claimCoverage,
    answer: run.answer.startsWith(SYNTHETIC_EVIDENCE_NOTICE) ? run.answer : `${SYNTHETIC_EVIDENCE_NOTICE}\n\n${run.answer}`,
    confidence: { level: "Low", reason: "Contains synthetic demo material; its measurements cannot support factual conclusions." } };
}

export interface EvidenceProvenanceLookup {
  sourceIds: string[];
  itemIds: string[];
}
export type EvidenceProvenanceResolver = (lookup: EvidenceProvenanceLookup) => Promise<ReadonlySet<string>>;

/** One metadata-only, request-local lookup for a page; no paid body reads or enduring cache. */
export async function projectRecordedEvidenceProvenance(resolve: EvidenceProvenanceResolver, run: QueryRun): Promise<QueryRun> {
  return (await projectRecordedEvidenceProvenanceList(resolve, [run]))[0];
}
export async function projectRecordedEvidenceProvenanceList(resolve: EvidenceProvenanceResolver, runs: QueryRun[]): Promise<QueryRun[]> {
  const references = runs.flatMap(run => [...run.citations, ...run.decisions, ...(run.evidence ?? [])]);
  const sourceIds = [...new Set(references.map(item => item.sourceId))];
  const itemIds = [...new Set(references.flatMap(item => item.itemId ? [item.itemId] : []))];
  const flags = references.length ? await resolve({ sourceIds, itemIds }) : new Set<string>();
  const mark = <T extends { sourceId: string; itemId?: string }>(item: T): T =>
    flags.has(`source:${item.sourceId}`) || item.itemId && flags.has(`item:${item.sourceId}:${item.itemId}`)
      ? { ...item, evidenceProvenance: "synthetic-demo" } : item;
  return runs.map(run => demoteSyntheticEvidence({ ...run, citations: run.citations.map(mark), decisions: run.decisions.map(mark),
    ...(run.evidence ? { evidence: run.evidence.map(mark) } : {}) }));
}
