/**
 * Deterministic evidence gate between model prose and creator money.
 *
 * The reasoning engine may propose citations, evidence spans, coverage, and attribution. None of
 * those proposals authorize a citation reward by themselves. This module accepts only source
 * markers that are present in the answer, declared by synthesis, backed by a quote that occurs in
 * the gathered source, and strong enough to meet the product's grounding threshold.
 */

import type {
  ClaimSufficiency,
  GatheredContent,
  ProposedEvidence,
} from "../llm/reasoning-engine";
import type {
  ClaimCoverageRecord,
  EvidenceRecord,
} from "../types";

export const MIN_REWARD_SUPPORT = 0.4;
const MIN_QUOTE_LENGTH = 8;
// Evidence is persisted in the public dispatch receipt after Keryx has paid the access toll.
// Keep it citation-sized so the ledger cannot become a substitute for the gated source.
const MAX_QUOTE_LENGTH = 240;

export interface EvidenceLedger {
  evidence: EvidenceRecord[];
  claimCoverage: ClaimCoverageRecord[];
  acceptedMarkers: Set<string>;
  droppedEvidence: number;
  droppedCitations: string[];
}

/**
 * Build the reward-authorizing ledger. Coverage is deliberately conservative: a model assessment
 * cannot lift a claim above its strongest verified evidence span, and a span cannot lift it above
 * the final assessment.
 */
export function buildEvidenceLedger(input: {
  subClaims: string[];
  gathered: GatheredContent[];
  answer: string;
  declaredMarkers: string[];
  proposedEvidence: ProposedEvidence[];
  finalAssessment?: ClaimSufficiency[];
  /** Fail closed when the final assessment transport failed after paid reads completed. */
  rewardAuthorizationAvailable?: boolean;
}): EvidenceLedger {
  const byMarker = new Map(input.gathered.map((g) => [g.marker, g]));
  const answerMarkers = extractAnswerMarkers(input.answer);
  const declared = new Set(
    input.declaredMarkers.filter((marker) => byMarker.has(marker)),
  );
  const evidence: EvidenceRecord[] = [];
  let droppedEvidence = 0;

  for (const proposal of input.proposedEvidence) {
    const claimIndex = Number(proposal?.claimIndex);
    const source = byMarker.get(String(proposal?.marker ?? ""));
    const quote =
      typeof proposal?.quote === "string" ? proposal.quote.trim() : "";
    if (
      !Number.isInteger(claimIndex) ||
      claimIndex < 0 ||
      claimIndex >= input.subClaims.length ||
      !source ||
      !quoteOccursInSource(quote, source.text)
    ) {
      droppedEvidence++;
      continue;
    }

    const support = clamp01(Number(proposal.support));
    evidence.push({
      claimIndex,
      claim: input.subClaims[claimIndex]!,
      marker: source.marker,
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      itemId: source.itemId,
      itemTitle: source.itemTitle,
      itemUrl: source.itemUrl,
      contentVersion: source.contentVersion,
      itemPublishedAt: source.itemPublishedAt,
      contentReceipt: source.contentReceipt,
      quote,
      support,
      qualifiesForReward:
        input.rewardAuthorizationAvailable !== false &&
        support >= MIN_REWARD_SUPPORT &&
        answerMarkers.has(source.marker) &&
        declared.has(source.marker),
    });
  }

  const acceptedMarkers = new Set(
    evidence
      .filter((item) => item.qualifiesForReward)
      .map((item) => item.marker),
  );
  const proposedCitationMarkers = new Set([
    ...answerMarkers,
    ...declared,
  ]);
  const droppedCitations = [...proposedCitationMarkers].filter(
    (marker) => byMarker.has(marker) && !acceptedMarkers.has(marker),
  );

  const assessmentByClaim = assessmentCoverage(
    input.subClaims,
    input.finalAssessment,
  );
  const claimCoverage = input.subClaims.map((claim, claimIndex) => {
    const qualifying = evidence.filter(
      (item) =>
        item.claimIndex === claimIndex && item.qualifiesForReward,
    );
    const strongestEvidence = qualifying.reduce(
      (max, item) => Math.max(max, item.support),
      0,
    );
    return {
      claimIndex,
      claim,
      coverage: round(
        Math.min(assessmentByClaim[claimIndex] ?? 0, strongestEvidence),
      ),
      coveredBy: [...new Set(qualifying.map((item) => item.marker))],
    } satisfies ClaimCoverageRecord;
  });

  return {
    evidence,
    claimCoverage,
    acceptedMarkers,
    droppedEvidence,
    droppedCitations,
  };
}

export function extractAnswerMarkers(answer: string): Set<string> {
  const markers = new Set<string>();
  for (const match of answer.matchAll(/\[(S\d+)\]/g)) {
    if (match[1]) markers.add(match[1]);
  }
  return markers;
}

/** Remove source markers that did not earn a place in the ledger, so a rejected citation cannot
 *  remain visible in the answer as if it still had a footnote or payout behind it. */
export function removeUnsupportedCitationMarkers(
  answer: string,
  acceptedMarkers: Set<string>,
): string {
  return answer.replace(
    /[ \t]*\[(S\d+)\]/g,
    (whole, marker: string) =>
      acceptedMarkers.has(marker) ? whole : "",
  );
}

function quoteOccursInSource(quote: string, source: string): boolean {
  const normalizedQuote = normalize(quote);
  if (
    normalizedQuote.length < MIN_QUOTE_LENGTH ||
    normalizedQuote.length > MAX_QUOTE_LENGTH
  ) {
    return false;
  }
  return normalize(source).includes(normalizedQuote);
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function assessmentCoverage(
  subClaims: string[],
  assessment?: ClaimSufficiency[],
): number[] {
  const byClaim = new Map<string, number>();
  for (const item of assessment ?? []) {
    if (typeof item?.claim !== "string") continue;
    byClaim.set(normalize(item.claim), clamp01(Number(item.coverage)));
  }
  return subClaims.map((claim) => byClaim.get(normalize(claim)) ?? 0);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
