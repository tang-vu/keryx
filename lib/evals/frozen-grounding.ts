import type { EvidenceRecord, PaymentRecord, QueryRun } from "../types";
import type { AgentEvalCase } from "./types";

const MIN_SUPPORT = 0.4;
// The retained evidence contract permits citation-sized excerpts and rounds coverage to six places.
const MIN_QUOTE_LENGTH = 8;
const MAX_QUOTE_LENGTH = 240;

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function unitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function identifiesClaim(run: QueryRun, index: number, claim: string): boolean {
  return Number.isInteger(index) && index >= 0 && index < run.subClaims.length &&
    run.subClaims[index] === claim;
}

/** Independent eval assertions, deliberately separate from the production evidence gate.
 * Literal corpus membership and marker consistency do not establish relevance, entailment or truth.
 * Eligibility flags and support remain reported estimates; they cannot substitute for these checks.
 */
export function auditFrozenGrounding(testCase: AgentEvalCase, run: QueryRun, recordedFetches: PaymentRecord[]): {
  hardFailures: string[];
  groundedClaimCount: number;
  rewardEvidenceSourceIds: Set<string>;
} {
  const hardFailures: string[] = [];
  const sources = new Map(testCase.sources.map((entry) => [entry.source.id, entry]));
  const answerMarkers = new Set([...run.answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]!));
  const citations = new Map(run.citations.map((citation) => [citation.marker, citation]));
  const ambiguousMarkers = new Set<string>();
  const seenMarkers = new Set<string>();
  for (const citation of run.citations) {
    if (seenMarkers.has(citation.marker)) {
      ambiguousMarkers.add(citation.marker);
      hardFailures.push(`duplicate citation marker ${citation.marker}`);
    }
    seenMarkers.add(citation.marker);
  }

  const eligible: EvidenceRecord[] = [];
  for (const [index, evidence] of (run.evidence ?? []).entries()) {
    const fail = (reason: string) => hardFailures.push(`evidence ${index}: ${reason}`);
    if (!identifiesClaim(run, evidence.claimIndex, evidence.claim) || !unitInterval(evidence.support)) {
      fail("invalid claim identity or support");
      continue;
    }
    const citation = citations.get(evidence.marker);
    const declaredItem = evidence.itemId ?? citation?.itemId;
    const source = sources.get(evidence.sourceId);
    const items = (source?.items ?? []).filter((item) =>
      item.sourceId === evidence.sourceId && (declaredItem === undefined || item.id === declaredItem));
    const quote = normalizedText(evidence.quote);
    // Legacy records without item identity may match one individual body, never joined items.
    const matchingBodies = items.filter((item) => normalizedText(item.content).includes(quote));
    if (evidence.quote.length > MAX_QUOTE_LENGTH || quote.length < MIN_QUOTE_LENGTH ||
        quote.length > MAX_QUOTE_LENGTH || matchingBodies.length === 0) {
      fail("quote is absent from the identified frozen source item or exceeds excerpt bounds");
      continue;
    }
    // Each eval starts with fresh storage: a paid frozen body needs this run's fetch observation.
    // Free/public tool reads are not represented by the paid-fetch metric.
    if (source!.source.fetchPrice > 0 && !recordedFetches.some((payment) =>
      payment.sourceId === evidence.sourceId && matchingBodies.some((item) =>
        payment.itemId === item.id))) {
      fail("paid frozen item has no matching fetch record for this run");
      continue;
    }
    const qualifiesForAnswer = evidence.qualifiesForAnswer ?? evidence.qualifiesForReward;
    if (evidence.qualifiesForReward && !qualifiesForAnswer) {
      fail("reward evidence is not eligible for the answer");
      continue;
    }
    if (!qualifiesForAnswer) continue;
    if (evidence.support < MIN_SUPPORT || ambiguousMarkers.has(evidence.marker) ||
        !answerMarkers.has(evidence.marker) || !citation || citation.sourceId !== evidence.sourceId ||
        (citation.itemId !== undefined && evidence.itemId !== undefined && citation.itemId !== evidence.itemId)) {
      fail("answer eligibility has no matching answer marker, citation identity or sufficient support");
      continue;
    }
    eligible.push(evidence);
  }

  for (const marker of new Set([...answerMarkers, ...citations.keys()])) {
    if (!eligible.some((evidence) => evidence.marker === marker)) {
      hardFailures.push(`citation marker ${marker} has no verified answer evidence`);
    }
  }

  const coverage = run.claimCoverage ?? [];
  const counts = new Map<number, number>();
  for (const row of coverage) counts.set(row.claimIndex, (counts.get(row.claimIndex) ?? 0) + 1);
  const groundedClaims = new Set<number>();
  for (const row of coverage) {
    const fail = (reason: string) => hardFailures.push(`coverage ${row.claimIndex}: ${reason}`);
    if (!identifiesClaim(run, row.claimIndex, row.claim) || !unitInterval(row.coverage) ||
        counts.get(row.claimIndex) !== 1) {
      fail("invalid or duplicate claim identity or coverage");
      continue;
    }
    const witnesses = eligible.filter((evidence) => evidence.claimIndex === row.claimIndex &&
      row.coveredBy.includes(evidence.marker));
    if (row.coveredBy.some((marker) => !witnesses.some((evidence) => evidence.marker === marker))) {
      fail("marker has no verified evidence for this claim");
      continue;
    }
    const strongest = witnesses.reduce((max, evidence) => Math.max(max, evidence.support), 0);
    const roundedSupport = Math.round(strongest * 1_000_000) / 1_000_000;
    if (row.coverage > roundedSupport) {
      fail("coverage exceeds its verified evidence support");
      continue;
    }
    if (row.coverage >= MIN_SUPPORT) groundedClaims.add(row.claimIndex);
  }

  return {
    hardFailures,
    groundedClaimCount: groundedClaims.size,
    rewardEvidenceSourceIds: new Set(eligible.filter((evidence) => evidence.qualifiesForReward)
      .map((evidence) => evidence.sourceId)),
  };
}
