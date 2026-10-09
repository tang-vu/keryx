import type { GatheredContent } from "../../llm/reasoning-engine";
import type { PaymentRecord, QueryRun } from "../../types";
import { microFromUsdc, retainedItem, type StudyQuestion } from "./contract";

export interface Rate { numerator: number; denominator: number; value: number | null }
export function rate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}
/** Closed-fixture literal/read checks, deliberately independent of model support scores. No entailment inference. */
export function gradeTrial(question: StudyQuestion, run: QueryRun, reads: GatheredContent[], payments: PaymentRecord[]) {
  const verified = (run.evidence ?? []).filter(evidence => {
    const doc = question.documents.find(candidate => retainedItem(question.id, candidate).id === evidence.itemId);
    const read = reads.find(candidate => candidate.marker === evidence.marker && candidate.sourceId === evidence.sourceId);
    if (!doc || !read || evidence.sourceId !== `${question.id}-${doc.id}` || !evidence.quote.trim()
      || evidence.contentVersion !== doc.contentVersion || read.contentVersion !== doc.contentVersion
      || evidence.itemUrl !== retainedItem(question.id, doc).link || read.itemId !== evidence.itemId
      || evidence.contentReceipt?.bodyHash !== doc.bodyHash || read.contentReceipt?.bodyHash !== doc.bodyHash
      || !doc.body.includes(evidence.quote) || !read.text.includes(evidence.quote)
      || !run.answer.includes(`[${evidence.marker}]`) || !run.answer.includes(evidence.quote)
      || !run.citations.some(citation => citation.marker === evidence.marker && citation.sourceId === evidence.sourceId
        && citation.itemId === evidence.itemId && citation.contentVersion === doc.contentVersion)) return false;
    return doc.free || payments.some(payment => payment.kind === "fetch" && payment.queryId === run.id
      && payment.sourceId === evidence.sourceId && payment.itemId === evidence.itemId && payment.contentVersion === doc.contentVersion
      && payment.settled === false && payment.settlementStatus === "simulated" && payment.txHash === null);
  });
  const literalClaimIndexes = new Set(verified.map(evidence => evidence.claimIndex)
    .filter(index => Number.isSafeInteger(index) && index >= 0 && index < run.subClaims.length));
  const completeFacts = question.facts.filter(fact => run.answer.includes(fact.literal) && verified.some(evidence =>
    evidence.quote.includes(fact.literal) && fact.documentIds.some(docId => evidence.sourceId === `${question.id}-${docId}`)));
  const cited = run.citations.filter(citation => verified.some(evidence => evidence.marker === citation.marker));
  const fetchMicro = payments.filter(payment => payment.kind === "fetch")
    .reduce((sum, payment) => sum + microFromUsdc(payment.amountUsdc), 0n);
  const rewards = new Map<string, bigint>();
  for (const payment of payments.filter(payment => payment.kind === "citation"))
    rewards.set(payment.sourceId!, (rewards.get(payment.sourceId!) ?? 0n) + microFromUsdc(payment.amountUsdc));
  const sortedRewards = [...rewards].sort(([a], [b]) => a.localeCompare(b, "en"));
  const citationMicro = sortedRewards.reduce((sum, [, amount]) => sum + amount, 0n);
  const max = sortedRewards.reduce((highest, [, amount]) => amount > highest ? amount : highest, 0n);
  const squares = sortedRewards.reduce((sum, [, amount]) => sum + amount * amount, 0n);
  return { literalReadBoundClaimRate: rate(literalClaimIndexes.size, run.subClaims.length),
    requiredFactCompleteness: rate(completeFacts.length, question.facts.length),
    literalReadBoundCitationRate: rate(cited.length, run.citations.length),
    completeFactIds: completeFacts.map(fact => fact.id), verifiedEvidenceCount: verified.length,
    actualReads: reads.length, paidReads: payments.filter(payment => payment.kind === "fetch").length,
    fetchMicro: String(fetchMicro), citationMicro: String(citationMicro),
    rewardBySourceMicro: Object.fromEntries(sortedRewards.map(([source, amount]) => [source, String(amount)])),
    topRewardShare: citationMicro === 0n ? null : { numerator: String(max), denominator: String(citationMicro) },
    rewardHhi: citationMicro === 0n ? null : { numerator: String(squares), denominator: String(citationMicro * citationMicro) },
    semanticCorrectness: null, counterfactualPolicyWinner: null, explorationEffect: null, realLlmSpend: null };
}
