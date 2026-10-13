import { expect, it } from "vitest";
import sample from "../../docs/research-evidence-audit-example.json";
import { auditResearchEvidence, capturedDecisionCommitment } from "./evidence-audit";
import { evidenceAuditInput, MAX_EVIDENCE_AUDIT_BYTES } from "./evidence-audit-contract";
import { browserSha256 } from "../browser-receipt-integrity";
import { canonicalJson } from "../canonical-json";

function fixture() { return structuredClone(sample); }
async function rehash(input: ReturnType<typeof fixture>) {
  input.receipt.payload.dispatch.answerSha256 = await browserSha256(input.receipt.payload.dispatch.answer);
  input.receipt.integrity.digest = await browserSha256(canonicalJson(input.receipt.payload));
  input.costs.receiptDigest = input.receipt.integrity.digest;
  input.review.receiptDigest = input.receipt.integrity.digest;
  input.review.answerSha256 = input.receipt.payload.dispatch.answerSha256;
  return input;
}
const run = (input: unknown) => auditResearchEvidence(JSON.stringify(input));

it("keeps the explicitly synthetic offline example separate from money and absent provider bills", async () => {
  const result = await run(fixture());
  expect(result.economics).toMatchObject({ supportedClaims: 1, claimPopulation: 1, ledgerCostComplete: false,
    accessMicroUsdc: "0", citationMicroUsdc: "0", sourceCostPerSupportedClaim: null, providerCostStatus: "unknown", providerCostPerSupportedClaim: null });
  expect(result.receiptCheck).toBe("self-check-only");
  expect(result.decisionLinks[0]).toMatchObject({ access: "simulated", citation: "not-recorded", temporalProof: "unproven" });
});

it("measures exact recorded source micros and invoice-declared USD separately with a rational denominator", async () => {
  const input = fixture();
  Object.assign(input.receipt.payload.settlement, { mode: "real", ledgerCompleteness: "complete", expectedRecordedPaymentsAtFinish: 2 });
  const first = input.receipt.payload.settlement.creatorPayments[0];
  Object.assign(first, { status: "settled", circleTransferId: "synthetic-fetch-transfer" });
  input.receipt.payload.settlement.creatorPayments.push({ ...first, kind: "citation", amountUsdc: 0.001, circleTransferId: "synthetic-reward-transfer" } as typeof first);
  Object.assign(input.costs, { llm: { status: "invoice-reconciled", amountMicroUsd: "900719925474099300", reference: "synthetic-invoice" },
    search: { status: "invoice-reconciled", amountMicroUsd: "1", reference: "synthetic-search" },
    other: { status: "invoice-reconciled", amountMicroUsd: "0", reference: "synthetic-zero-allocation" } });
  const result = await run(await rehash(input));
  expect(result.economics.sourceCostPerSupportedClaim).toEqual({ numeratorMicros: "3000", denominatorSupportedClaims: 1 });
  expect(result.economics.providerCostPerSupportedClaim).toEqual({ numeratorMicros: "900719925474099301", denominatorSupportedClaims: 1 });
  expect(result.economics.providerCostStatus).toBe("supplied-invoice-reconciled");
  expect(result.decisionLinks[0]).toMatchObject({ access: "settled", citation: "settled" });
});

it("requires a report-bound human review rather than coverage/model support alone", async () => {
  const input = fixture();
  const result = await run({ ...input, review: null });
  expect(result.economics.supportedClaims).toBe(0); expect(result.reviewBasis).toBe("unavailable");
  expect(result.assessment).toEqual([{ claimIndex: 0, verdict: "unreviewed" }]);
  for (const edit of [() => input.review.receiptDigest = "sha256:" + "b".repeat(64),
    () => input.review.answerSha256 = "sha256:" + "b".repeat(64)]) {
    edit(); await expect(run(input)).rejects.toThrow("refused");
  }
});

it("refuses absent, nonqualifying, foreign-version and uncited evidence in a supported review", async () => {
  for (const kind of ["absent", "empty", "nonqualifying", "version", "citation", "zero-support", "foreign-claim", "duplicate"] as const) {
    const input = fixture();
    if (kind === "absent") input.review.claims[0].evidence = [];
    if (kind === "empty") input.receipt.payload.claims[0].evidence[0].quote = " ";
    if (kind === "nonqualifying") Object.assign(input.receipt.payload.claims[0].evidence[0], { qualifiesForAnswer: false });
    if (kind === "version") input.review.claims[0].evidence[0].contentVersion = "another-version";
    if (kind === "citation") input.receipt.payload.citations = [];
    if (kind === "zero-support") input.receipt.payload.claims[0].evidence[0].support = 0;
    if (kind === "foreign-claim") input.review.claims[0].claimIndex = 5;
    if (kind === "duplicate") input.review.claims.push(input.review.claims[0]);
    await rehash(input); await expect(run(input), kind).rejects.toThrow("refused");
  }
});

it("rejects payload/answer tampering and compares independently supplied receipt digests", async () => {
  const input = fixture(); const expected = input.receipt.integrity.digest;
  expect((await auditResearchEvidence(JSON.stringify(input), { expectedReceiptDigest: expected })).receiptCheck).toBe("retained-digest-match");
  input.receipt.payload.dispatch.answer += " Changed";
  await expect(run(input)).rejects.toThrow();
  await rehash(input);
  await expect(auditResearchEvidence(JSON.stringify(input), { expectedReceiptDigest: expected })).rejects.toThrow();
  input.receipt.payload.dispatch.answerSha256 = "sha256:" + "0".repeat(64);
  input.receipt.integrity.digest = await browserSha256(canonicalJson(input.receipt.payload)); input.costs.receiptDigest = input.receipt.integrity.digest;
  await expect(run(input)).rejects.toThrow();
});

it("commits immutable initial capture separately from later verdict/projection/result and checks retained commitments", async () => {
  const input = fixture(), decision = evidenceAuditInput.parse(input).decisions[0];
  const digest = await capturedDecisionCommitment(decision);
  expect(await capturedDecisionCommitment({ ...decision, codeAction: "SKIP", codeRule: "terms-changed", state: "cancelled" })).toBe(digest);
  expect(await capturedDecisionCommitment({ ...decision, terms: { ...decision.terms, priceMicroUsdc: "2001" } })).not.toBe(digest);
  const trust = { expectedDecisionDigests: [{ id: decision.id, digest }] };
  expect((await auditResearchEvidence(JSON.stringify(input), trust)).decisionLinks[0].commitmentCheck).toBe("retained-digest-match");
  input.decisions[0].terms.priceMicroUsdc = "2001";
  await expect(auditResearchEvidence(JSON.stringify(input), trust)).rejects.toThrow();
  await expect(auditResearchEvidence(JSON.stringify(fixture()), { expectedDecisionDigests: [{ id: "33333333-3333-4333-8333-333333333333", digest }] })).rejects.toThrow();
});

it("labels wrong amount, wrong payee, before-capture rows, disallowed access and excessive citation as mismatches", async () => {
  for (const kind of ["amount", "payee", "time", "cache", "skip", "reward"] as const) {
    const input = fixture(), row = input.receipt.payload.settlement.creatorPayments[0];
    if (kind === "amount") row.amountUsdc = 0.002001;
    if (kind === "payee") row.payee = "0x" + "2".repeat(40);
    if (kind === "time") row.createdAt = "2026-10-12T09:58:00.000Z";
    if (kind === "cache") Object.assign(input.decisions[0], { initialCodeAction: "CACHE" });
    if (kind === "skip") Object.assign(input.decisions[0], { initialCodeAction: "SKIP" });
    if (kind === "reward") Object.assign(row, { kind: "citation", amountUsdc: 0.001001 });
    const result = await run(await rehash(input));
    expect(kind === "reward" ? result.decisionLinks[0].citation : result.decisionLinks[0].access, kind).toBe("terms-mismatch");
  }
});

it("never guesses repeated decisions/payments, missing versions or absent historical sidecars", async () => {
  for (const kind of ["decisions", "payments", "version"] as const) {
    const input = fixture();
    if (kind === "decisions") input.decisions.push({ ...input.decisions[0], id: "33333333-3333-4333-8333-333333333333", ordinal: 1 });
    if (kind === "payments") input.receipt.payload.settlement.creatorPayments.push(input.receipt.payload.settlement.creatorPayments[0]);
    if (kind === "version") delete (input.decisions[0].terms as { contentVersion?: string }).contentVersion;
    expect((await run(await rehash(input))).decisionLinks[0].access, kind).toBe("ambiguous");
  }
  const input = fixture(); input.decisions = [];
  const result = await run(input); expect(result.decisionLinks).toEqual([]); expect(result.unmatchedCreatorPayments).toBe(1);
});

it("compares parsed instants when an existing capture omits canonical millisecond formatting", async () => {
  const input = fixture(); input.decisions[0].createdAt = "2026-10-12T09:59:00Z";
  input.receipt.payload.settlement.creatorPayments[0].createdAt = "2026-10-12T09:59:00.001Z";
  expect((await run(await rehash(input))).decisionLinks[0].access).toBe("simulated");
});

it("refuses foreign runs/networks, duplicate transfer IDs and real/simulation mixing", async () => {
  for (const kind of ["run", "network", "settled-without-ref", "duplicate-ref", "simulation"] as const) {
    const input = fixture();
    if (kind === "run") input.decisions[0].runId = "33333333-3333-4333-8333-333333333333";
    if (kind === "network") input.network = "eip155:5042";
    if (kind === "settled-without-ref") Object.assign(input.receipt.payload.settlement.creatorPayments[0], { status: "settled" });
    if (kind === "duplicate-ref") {
      const row = { ...input.receipt.payload.settlement.creatorPayments[0], circleTransferId: "same-transfer" };
      input.receipt.payload.settlement.creatorPayments = [row, row];
    }
    if (kind === "simulation") input.receipt.payload.settlement.mode = "real";
    await expect(run(await rehash(input)), kind).rejects.toThrow();
  }
});

it("withholds full source cost for pending, incomplete, legacy and zero-denominator observations", async () => {
  for (const kind of ["pending", "incomplete", "legacy", "count", "unsupported"] as const) {
    const input = fixture();
    Object.assign(input.receipt.payload.settlement, { mode: "real", ledgerCompleteness: "complete", expectedRecordedPaymentsAtFinish: 1 });
    Object.assign(input.receipt.payload.settlement.creatorPayments[0], { status: "settled", circleTransferId: "synthetic-ref" });
    if (kind === "pending") input.receipt.payload.settlement.creatorPayments[0].status = "pending";
    if (kind === "incomplete") input.receipt.payload.settlement.ledgerCompleteness = "incomplete";
    if (kind === "legacy") input.receipt.payload.settlement.mode = "legacy";
    if (kind === "count") Object.assign(input.receipt.payload.settlement, { expectedRecordedPaymentsAtFinish: 2 });
    if (kind === "unsupported") input.review.claims[0].verdict = "unsupported";
    expect((await run(await rehash(input))).economics.sourceCostPerSupportedClaim, kind).toBeNull();
  }
});

it("propagates provider estimates, unknown components, exact zero and rejects invalid amount encodings", async () => {
  const input = fixture();
  Object.assign(input.costs, { llm: { status: "estimated", amountMicroUsd: "5", reference: "synthetic-estimate" },
    search: { status: "invoice-reconciled", amountMicroUsd: "0", reference: "synthetic-zero" }, other: { status: "invoice-reconciled", amountMicroUsd: "0", reference: "synthetic-zero" } });
  expect((await run(input)).economics).toMatchObject({ providerCostStatus: "estimated", providerCostPerSupportedClaim: { numeratorMicros: "5", denominatorSupportedClaims: 1 } });
  for (const value of ["-1", "1e6", "0.1", "01", "9".repeat(31)]) {
    Object.assign(input.costs.llm, { amountMicroUsd: value }); await expect(run(input)).rejects.toThrow();
  }
});

it("bounds input, closes outer schemas and emits generic errors without private content", async () => {
  await expect(auditResearchEvidence(" ".repeat(MAX_EVIDENCE_AUDIT_BYTES + 1))).rejects.toThrow("refused");
  await expect(run({ ...fixture(), privateSentinel: "secret-sentinel" })).rejects.toThrow("refused");
  await expect(auditResearchEvidence("secret-sentinel")).rejects.not.toThrow("secret-sentinel");
  const input = fixture(); input.receipt.payload.settlement.creatorPayments[0].amountUsdc = 0.0000001;
  await expect(run(await rehash(input))).rejects.toThrow();
});
