/** Disposable metadata-only fixtures. They never sign, call a supplier, or claim real settlement. */
import { syntheticA2aOriginal } from "./a2a-original-fixture";
import type { A2aOrder } from "../a2a/order";
import type { ArcNetworkProfile } from "../arc-network-profile";
import { ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { failedOriginalEvidenceSha256, fulfillmentObjectSha256, fulfillmentSha256,
  type FulfillmentAuthority, type FulfillmentClaimInput, type A2aFulfillmentClaim,
  type A2aFulfillmentCompletion } from "../a2a/failed-original-fulfillment-protocol";
import type { QueryRun } from "../types";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";

export function syntheticFailedOriginal(index = 1, profile: ArcNetworkProfile = ARC_TESTNET_PROFILE) {
  const fixture = syntheticA2aOriginal(index, profile);
  const order: A2aOrder = { ...fixture.order, status: "failed", errorCode: "research_failed",
    startedAt: "2026-10-06T03:24:02.000Z", workerId: "synthetic-original-worker",
    updatedAt: "2026-10-06T03:24:03.000Z" };
  const authority: FulfillmentAuthority = {
    format: "keryx-a2a-failed-original-fulfillment-authority-v1", original: fixture.binding,
    question: order.request!.question, input: { format: "keryx-canary-original-fulfillment-input-v1",
      questionSha256: fulfillmentSha256(order.request!.question), scopeBasis: "reviewed-original-question-reconstruction",
      targets: ["A synthetic first target", "A synthetic preserved gap"], constraints: [],
      sourceManifestSha256: "aa".repeat(32), selectedDocumentIds: ["document-one"] },
    authorizationSha256: "ab".repeat(32), policySha256: "ac".repeat(32), failedClosureSha256: "ad".repeat(32),
    originalEvidenceSha256: failedOriginalEvidenceSha256(order), originalProviderLedgerSha256: "ae".repeat(32),
    executorCommit: "a".repeat(40), expiresAt: "2026-10-07T00:00:00.000Z",
  };
  const input: FulfillmentClaimInput = { authority, claimId: fulfillmentSha256(`synthetic-claim-${index}`),
    claimedAt: "2026-10-06T10:00:00.000Z" };
  return { ...fixture, order, authority, input };
}
export function syntheticFulfilledRun(claim: A2aFulfillmentClaim): A2aFulfillmentCompletion {
  const ledgerSha256 = "af".repeat(32), statement = { claimIndex: 0, marker: "S1",
    quote: "Synthetic exact source quote.", text: "A synthetic reviewed statement." };
  const run: QueryRun = { id: claim.authority.original.queryId, question: claim.authority.question,
    budget: 0.01, engine: "llm:deepseek:deepseek-v4-flash", researchMode: "quick", origin: "a2a", paymentMode: "real",
    subClaims: [...claim.authority.input.targets], decisions: [],
    citations: [{ marker: "S1", sourceId: "public:fulfillment:document-one", sourceName: "Synthetic official document",
      sourceKind: "public-reference", weight: 1, reward: 0, rationale: "Synthetic bounded evidence" }],
    evidence: [{ ...statement, claim: claim.authority.input.targets[0], sourceId: "public:fulfillment:document-one",
      sourceName: "Synthetic official document", sourceKind: "public-reference", support: 0.9,
      qualifiesForAnswer: true, qualifiesForReward: false }],
    claimCoverage: claim.authority.input.targets.map((claim, claimIndex) => ({ claim, claimIndex,
      coverage: claimIndex === 0 ? 0.9 : 0, coveredBy: claimIndex === 0 ? ["S1"] : [] })),
    answer: `${statement.text} [S1]\n\nThe second target remains a visible evidence gap.`,
    totalSpent: 0, totalToCreators: 0, pendingSpendUsdc: 0, paymentAttempts: 0, settledPayments: 0, pendingPayments: 0,
    trace: [], createdAt: "2026-10-06T10:00:01.000Z",
    originalFulfillment: { format: "keryx-a2a-original-fulfillment-result-v1", claimId: claim.claimId,
      authoritySha256: fulfillmentObjectSha256(claim.authority), inputSha256: fulfillmentObjectSha256(claim.authority.input),
      originalFailureSha256: claim.authority.originalEvidenceSha256, providerLedgerSha256: ledgerSha256,
      originalProviderBilling: "unknown", noNewInboundPayment: true, statements: [statement], evidenceGaps: [] } };
  run.answer = finalizeGroundedAnswer({ question: run.question, answer: "", statements: [statement],
    ledger: { evidence: run.evidence!, claimCoverage: run.claimCoverage!, acceptedMarkers: new Set(["S1"]),
      droppedEvidence: 0, droppedCitations: [] } });
  return { claimId: claim.claimId, originalId: run.id, runSha256: fulfillmentObjectSha256(run),
    providerLedgerSha256: ledgerSha256, completedAt: "2026-10-06T10:00:02.000Z", run };
}
