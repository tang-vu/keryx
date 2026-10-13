import { browserSha256, verifyBrowserReceipt } from "../browser-receipt-integrity";
import { canonicalJson } from "../canonical-json";
import { captureDecisionSchema, type DecisionReview } from "../research/decision-review-types";
import { auditReceiptPayload, evidenceAuditInput, evidenceAuditTrust, MAX_EVIDENCE_AUDIT_BYTES,
  type EvidenceAuditInput, type EvidenceAuditTrust } from "./evidence-audit-contract";
import { decimalMicros } from "./exact-units";

export const EVIDENCE_AUDIT_LIMITS = [
  "Human reviews and cost references are supplied assertions, not independently authenticated assessments or invoices.",
  "Receipt checksums and retained decision digests do not prove Circle settlement, source truth, completeness or an independent pre-spend timestamp.",
  "USDC and USD remain separate. No exchange rate, profit, per-source causal attribution or customer traction is inferred.",
  "This audit cannot sign, spend, retry, refund, modify a receipt or change a research decision.",
] as const;
type Ratio = { numeratorMicros: string; denominatorSupportedClaims: number };
const ratio = (amount: bigint, count: number): Ratio | null => count ? { numeratorMicros: amount.toString(), denominatorSupportedClaims: count } : null;
const identity = (value: { sourceId: string; itemId?: string; contentVersion?: string }) =>
  value.itemId && value.contentVersion ? JSON.stringify([value.sourceId, value.itemId, value.contentVersion]) : null;

/** Commit only the immutable capture, never a later verdict, code projection or payment result. */
export async function capturedDecisionCommitment(decision: DecisionReview): Promise<`sha256:${string}`> {
  const input = captureDecisionSchema.parse({ policyVersion: decision.policyVersion, engine: decision.engine,
    requestedModel: decision.requestedModel, runId: decision.runId, round: decision.round, ordinal: decision.ordinal,
    sourceName: decision.sourceName, modelAction: decision.modelAction,
    codeAction: decision.initialCodeAction, codeRule: decision.initialCodeRule, terms: decision.terms,
    reviewFirst: decision.reviewFirst, cohort: decision.cohort, cohortEvidence: decision.cohortEvidence });
  return browserSha256(canonicalJson({ schema: "keryx-captured-decision-commitment-v1", id: decision.id, createdAt: decision.createdAt, input }));
}

/** JSON text keeps caller mutation/getters outside crypto awaits. All inputs are bounded local data. */
export async function auditResearchEvidence(json: string, trustInput: EvidenceAuditTrust = {}) {
  try {
    if (typeof json !== "string" || new TextEncoder().encode(json).byteLength > MAX_EVIDENCE_AUDIT_BYTES) throw Error();
    const input: EvidenceAuditInput = evidenceAuditInput.parse(JSON.parse(json));
    const trust = evidenceAuditTrust.parse(trustInput);
    const receipt = input.receipt as { integrity?: { digest?: string }; payload?: unknown };
    if (!(await verifyBrowserReceipt(receipt)).valid) throw Error();
    const digest = receipt.integrity!.digest!;
    if (trust.expectedReceiptDigest && digest !== trust.expectedReceiptDigest || input.costs.receiptDigest !== digest) throw Error();
    const payload = auditReceiptPayload.parse(receipt.payload);
    if (await browserSha256(payload.dispatch.answer) !== payload.dispatch.answerSha256) throw Error();
    const unique = (values: readonly string[]) => { if (new Set(values).size !== values.length) throw Error(); };
    unique(payload.claims.map(row => String(row.claimIndex)));
    unique(payload.citations.map(row => row.marker));
    unique(input.decisions.map(row => row.id));
    unique((trust.expectedDecisionDigests ?? []).map(row => row.id));
    if ((trust.expectedDecisionDigests ?? []).some(row => !input.decisions.some(decision => decision.id === row.id))) throw Error();
    const review = input.review;
    if (review && (review.receiptDigest !== digest || review.answerSha256 !== payload.dispatch.answerSha256 ||
      review.reviewedAt < payload.dispatch.createdAt)) throw Error();
    unique((review?.claims ?? []).map(row => String(row.claimIndex)));
    const assessment = payload.claims.map(claim => {
      const row = review?.claims.find(row => row.claimIndex === claim.claimIndex);
      if (!row || row.verdict !== "supported") return { claimIndex: claim.claimIndex, verdict: row?.verdict ?? "unreviewed" };
      if (!row.evidence.length) throw Error();
      unique(row.evidence.map(item => JSON.stringify(item)));
      for (const reference of row.evidence) {
        if (!claim.evidence.some(item => identity(item) === identity(reference) && item.marker === reference.marker &&
          item.quote.trim() && item.support > 0 && (item.qualifiesForAnswer ?? item.qualifiesForReward)) ||
          !payload.citations.some(item => identity(item) === identity(reference) && item.marker === reference.marker)) throw Error();
      }
      return { claimIndex: claim.claimIndex, verdict: "supported" };
    });
    if (review?.claims.some(row => !payload.claims.some(claim => row.claimIndex === claim.claimIndex))) throw Error();
    const supported = assessment.filter(row => row.verdict === "supported").length;
    const allPayments = [...payload.settlement.creatorPayments, ...(payload.settlement.operatingPayments ?? [])];
    if (allPayments.some(row => row.network !== input.network || row.status === "settled" && !row.circleTransferId)) throw Error();
    unique(allPayments.flatMap(row => row.circleTransferId ? [row.circleTransferId] : []));
    if (payload.settlement.mode === "offline" && allPayments.some(row => row.status !== "simulated") ||
      payload.settlement.mode === "real" && allPayments.some(row => row.status === "simulated")) throw Error();
    const complete = payload.settlement.mode === "real" && payload.settlement.ledgerCompleteness === "complete" &&
      payload.settlement.expectedRecordedPaymentsAtFinish === allPayments.length && !allPayments.some(row => row.status === "pending");
    const sum = (kind: "fetch" | "citation") => payload.settlement.creatorPayments
      .filter(row => row.kind === kind && row.status === "settled")
      .reduce((total, row) => total + BigInt(decimalMicros(row.amountUsdc)!), BigInt(0));
    const access = sum("fetch"), citation = sum("citation");
    const suppliedCosts = [input.costs.llm, input.costs.search, input.costs.other];
    const usdKnown = suppliedCosts.every(row => row.status !== "unknown");
    const usd = suppliedCosts.reduce((sum, row) => sum + (row.status === "unknown" ? BigInt(0) : BigInt(row.amountMicroUsd)), BigInt(0));
    const expected = new Map((trust.expectedDecisionDigests ?? []).map(row => [row.id, row.digest]));
    const links = [];
    for (const decision of input.decisions) {
      if (decision.runId !== payload.dispatch.id || decision.terms.network !== input.network || Date.parse(decision.createdAt) > Date.parse(payload.dispatch.createdAt)) throw Error();
      const commitment = await capturedDecisionCommitment(decision);
      if (expected.has(decision.id) && expected.get(decision.id) !== commitment) throw Error();
      const key = identity(decision.terms);
      const candidates = input.decisions.filter(other => identity(other.terms) === key);
      const rows = payload.settlement.creatorPayments.filter(row => key !== null && identity(row) === key);
      const accesses = rows.filter(row => row.kind === "fetch");
      const rewards = rows.filter(row => row.kind === "citation");
      // Exported receipts lack payment IDs/nonces; repeated decisions/payments cannot be joined reliably.
      const ambiguous = key === null || !decision.terms.owned || candidates.length !== 1 || accesses.length > 1 || rewards.length > 1;
      const payment = accesses[0];
      const permitted = decision.initialCodeAction === "BUY" && BigInt(decision.terms.priceMicroUsdc) > BigInt(0);
      const accessState = ambiguous ? "ambiguous" : !payment ? "not-recorded" :
        !permitted || payment.payee.toLowerCase() !== decision.terms.payTo || decimalMicros(payment.amountUsdc) !== decision.terms.priceMicroUsdc || Date.parse(payment.createdAt) < Date.parse(decision.createdAt) ? "terms-mismatch" : payment.status;
      const reward = rewards[0];
      const rewardState = ambiguous ? "ambiguous" : !reward ? "not-recorded" :
        decision.initialCodeAction === "SKIP" || reward.payee.toLowerCase() !== decision.terms.payTo || BigInt(decimalMicros(reward.amountUsdc)!) > BigInt(decision.terms.citationBudgetMicroUsdc) ||
        Date.parse(reward.createdAt) < Date.parse(decision.createdAt) ? "terms-mismatch" : reward.status;
      links.push({ decisionId: decision.id, commitment, commitmentCheck: expected.has(decision.id) ? "retained-digest-match" : "self-check-only",
        access: accessState, citation: rewardState, temporalProof: "unproven" as const });
    }
    return { schema: "keryx-evidence-audit-v1" as const, receiptDigest: digest, answerSha256: payload.dispatch.answerSha256,
      network: input.network, receiptCheck: trust.expectedReceiptDigest ? "retained-digest-match" : "self-check-only",
      reviewBasis: review ? "supplied-human-review" : "unavailable", assessment,
      economics: { supportedClaims: supported, claimPopulation: assessment.length, ledgerCostComplete: complete,
        accessMicroUsdc: access.toString(), citationMicroUsdc: citation.toString(),
        sourceCostPerSupportedClaim: complete ? ratio(access + citation, supported) : null,
        llm: input.costs.llm, search: input.costs.search, other: input.costs.other,
        providerCostStatus: !usdKnown ? "unknown" : suppliedCosts.some(row => row.status === "estimated") ? "estimated" : "supplied-invoice-reconciled",
        providerCostPerSupportedClaim: usdKnown ? ratio(usd, supported) : null },
      decisionLinks: links, unmatchedCreatorPayments: payload.settlement.creatorPayments.filter(row => !input.decisions.some(decision =>
        identity(decision.terms) !== null && identity(decision.terms) === identity(row) && decision.terms.payTo === row.payee.toLowerCase())).length,
      limits: EVIDENCE_AUDIT_LIMITS };
  } catch { throw Error("Evidence audit refused malformed, mismatched or unverifiable local data."); }
}
export type ResearchEvidenceAudit = Awaited<ReturnType<typeof auditResearchEvidence>>;
