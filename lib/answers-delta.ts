/** Compare two immutable dispatch receipts for the same question. */

import { deriveConfidence } from "./agent/confidence";
import { normalizeQuestion } from "./answers-archive";
import { paymentSettlementStatus } from "./payments/payment-state";
import type { Citation, PaymentRecord, QueryRun } from "./types";

export interface DeltaSource {
  sourceId: string;
  sourceName: string;
}

export interface AssetDelta extends DeltaSource {
  kind: "article" | "version";
  previousItemId: string;
  currentItemId: string;
  itemTitle?: string;
  previousVersion: string;
  currentVersion: string;
}

export interface CoverageDelta {
  previousAverage: number;
  currentAverage: number;
  matchedClaims: number;
  improvedClaims: number;
  regressedClaims: number;
}

export interface SettlementDelta {
  previousTotalUsdc: number;
  currentTotalUsdc: number;
  deltaUsdc: number;
}

export interface AnswerDelta {
  previousId: string;
  currentId: string;
  addedSources: DeltaSource[];
  removedSources: DeltaSource[];
  retainedSources: number;
  changedAssets: AssetDelta[];
  previousCitations: number;
  currentCitations: number;
  previousEvidenceSpans: number | null;
  currentEvidenceSpans: number | null;
  coverage: CoverageDelta | null;
  previousConfidence: string | null;
  currentConfidence: string | null;
  /** Real settled outbound payment delta, or null when the ledger cannot prove both totals. */
  settlement: SettlementDelta | null;
}

function sourceMap(citations: Citation[]): Map<string, DeltaSource> {
  const result = new Map<string, DeltaSource>();
  for (const citation of citations) {
    if (!citation.sourceId || result.has(citation.sourceId)) continue;
    result.set(citation.sourceId, {
      sourceId: citation.sourceId,
      sourceName: citation.sourceName,
    });
  }
  return result;
}

function versionMap(citations: Citation[]): Map<string, Citation & { itemId: string; contentVersion: string }> {
  const result = new Map<string, Citation & { itemId: string; contentVersion: string }>();
  for (const citation of citations) {
    if (!citation.sourceId || !citation.itemId || !citation.contentVersion) continue;
    result.set(citation.sourceId, citation as Citation & {
      itemId: string;
      contentVersion: string;
    });
  }
  return result;
}

function coverageDelta(previous: QueryRun, current: QueryRun): CoverageDelta | null {
  if (!previous.claimCoverage?.length || !current.claimCoverage?.length) return null;
  const previousByClaim = new Map(
    previous.claimCoverage.map((claim) => [normalizeQuestion(claim.claim), claim.coverage]),
  );
  const pairs = current.claimCoverage.flatMap((claim) => {
    const before = previousByClaim.get(normalizeQuestion(claim.claim));
    return before === undefined ? [] : [{ before, after: claim.coverage }];
  });
  if (pairs.length === 0) return null;

  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    previousAverage: average(pairs.map((pair) => pair.before)),
    currentAverage: average(pairs.map((pair) => pair.after)),
    matchedClaims: pairs.length,
    improvedClaims: pairs.filter((pair) => pair.after - pair.before >= 0.01).length,
    regressedClaims: pairs.filter((pair) => pair.before - pair.after >= 0.01).length,
  };
}

/**
 * Returns null for a true follow-up. Only a same-question re-ask gets a delta: comparing different
 * questions would make source and coverage movement look meaningful when it is merely different
 * scope.
 */
export function compareAnswerReceipts(
  previous: QueryRun,
  current: QueryRun,
  payments?: { previous: PaymentRecord[]; current: PaymentRecord[] },
): AnswerDelta | null {
  if (normalizeQuestion(previous.question) !== normalizeQuestion(current.question)) return null;

  const beforeSources = sourceMap(previous.citations);
  const afterSources = sourceMap(current.citations);
  const beforeVersions = versionMap(previous.citations);
  const afterVersions = versionMap(current.citations);

  const changedAssets: AssetDelta[] = [];
  for (const [sourceId, after] of afterVersions) {
    const before = beforeVersions.get(sourceId);
    if (
      !before ||
      (before.itemId === after.itemId && before.contentVersion === after.contentVersion)
    ) {
      continue;
    }
    changedAssets.push({
      sourceId: after.sourceId,
      sourceName: after.sourceName,
      kind: before.itemId === after.itemId ? "version" : "article",
      previousItemId: before.itemId,
      currentItemId: after.itemId,
      ...(after.itemTitle ? { itemTitle: after.itemTitle } : {}),
      previousVersion: before.contentVersion,
      currentVersion: after.contentVersion,
    });
  }

  const previousSettlement = payments
    ? settledCreatorTotal(previous, payments.previous)
    : null;
  const currentSettlement = payments ? settledCreatorTotal(current, payments.current) : null;

  return {
    previousId: previous.id,
    currentId: current.id,
    addedSources: [...afterSources.values()].filter((source) => !beforeSources.has(source.sourceId)),
    removedSources: [...beforeSources.values()].filter((source) => !afterSources.has(source.sourceId)),
    retainedSources: [...afterSources.keys()].filter((sourceId) => beforeSources.has(sourceId)).length,
    changedAssets,
    previousCitations: previous.citations.length,
    currentCitations: current.citations.length,
    previousEvidenceSpans: previous.evidence?.length ?? null,
    currentEvidenceSpans: current.evidence?.length ?? null,
    coverage: coverageDelta(previous, current),
    previousConfidence: deriveConfidence(previous)?.level ?? null,
    currentConfidence: deriveConfidence(current)?.level ?? null,
    settlement:
      previousSettlement !== null && currentSettlement !== null
        ? {
            previousTotalUsdc: previousSettlement,
            currentTotalUsdc: currentSettlement,
            deltaUsdc: currentSettlement - previousSettlement,
          }
        : null,
  };
}

/** Only Circle-settled outbound rows may appear as real creator money in the comparison. */
function settledCreatorTotal(run: QueryRun, payments: PaymentRecord[]): number | null {
  const outbound = payments.filter((payment) => payment.kind !== "inbound");
  const settled = outbound.filter((payment) => paymentSettlementStatus(payment) === "settled");

  // New runs carry the number settled at finish plus authorizations that were still pending. The
  // durable ledger may later promote those pending rows from exact Circle evidence, so its settled
  // count may grow only inside that recorded range. Falling below the original settled count means
  // a receipt row is missing and the total is not provable.
  if (run.settledPayments !== undefined) {
    const maximum = run.settledPayments + (run.pendingPayments ?? 0);
    if (settled.length < run.settledPayments || settled.length > maximum) return null;
  }
  if (outbound.length === 0) {
    if (run.paymentMode === "offline" || run.totalSpent === 0) return 0;
    return null;
  }
  return settled.reduce((sum, payment) => sum + payment.amountUsdc, 0);
}
