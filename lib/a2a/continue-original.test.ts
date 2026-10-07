import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeOriginalContinuation } from "./continue-original";
import { JsonChatEngine } from "../llm/json-chat-engine";
import { cleanFulfillmentFixtures, fixtureCommit, fixtureNow, fulfillmentFixture } from "../business-operator/fulfillment-test-fixture";
import { fulfillmentObjectSha256, validateFulfilledQueryRun, type A2aFulfillmentClaim } from "./failed-original-fulfillment-protocol";
import type { QueryRun } from "../types";

const policy = vi.hoisted(() => ({ begin: vi.fn(), model: vi.fn(), admission: vi.fn(), signal: vi.fn(), close: vi.fn(),
  ledger: vi.fn(), prepare: vi.fn(), diagnostic: vi.fn() }));
const git = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), execFileSync: git }));
vi.mock("../business-operator/fulfillment-continuation-policy", () => ({ beginOriginalContinuation: policy.begin,
  continuationModel: policy.model, assertContinuationSupplierAdmission: policy.admission,
  continuationSupplierSignal: policy.signal, closeContinuationCapability: policy.close,
  continuationProviderLedger: policy.ledger, prepareContinuationResult: policy.prepare,
  recordContinuationDiagnostic: policy.diagnostic }));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(fixtureNow); vi.resetAllMocks();
  git.mockImplementation((_command, args) => args?.[0] === "status" ? "" : `${fixtureCommit}\n`);
  policy.model.mockImplementation(async (_capability, _stage, _system, _user, _tokens, action) => action());
  policy.signal.mockImplementation(() => AbortSignal.timeout(10_000));
  policy.ledger.mockReturnValue({ sha256: "e".repeat(64), newModelCalls: 3, combinedReservedMicroUsd: 139960 });
});
afterEach(() => { cleanFulfillmentFixtures(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function admittedFixture(fiveRequiredTargets = false) {
  const value = await fulfillmentFixture();
  if (fiveRequiredTargets) {
    const targets = ["Contract-wallet support", "EOA payment flow", "Standard contract-wallet transfer flow",
      "Authorization and revocation limits", "Payment and delivery acceptance checks"];
    value.binding.packet.input.targets = [...targets];
    value.binding.authority.input.targets = [...targets];
    value.binding.authorization.requiredSupportedTargetIndexes = [0, 1, 2, 3, 4];
  }
  const claim: A2aFulfillmentClaim = { authority: value.binding.authority, claimId: "1".repeat(64),
    claimedAt: fixtureNow, failedOrder: structuredClone(value.order) };
  const capability = Object.freeze({});
  policy.begin.mockResolvedValue({ capability, binding: { original: value.binding }, claim });
  policy.prepare.mockImplementation((_capability, run: QueryRun) => {
    const completion = { claimId: claim.claimId, originalId: claim.authority.original.id,
      runSha256: fulfillmentObjectSha256(run), providerLedgerSha256: "e".repeat(64), completedAt: fixtureNow };
    validateFulfilledQueryRun(run, claim, completion);
    return completion;
  });
  return { ...value, claim, capability };
}
function replies(user: Record<string, unknown>, call: number) {
  if (call === 1) return { rationale: "Synthetic assessment.", perClaim: (user.subClaims as string[]).map((claim, index) => ({
    claim, supportedAnswer: "The frozen reference describes the mechanism.", missingRequestedParts: [], coverage: 0.9, coveredBy: [`S${index % 2 + 1}`] })) };
  if (call === 2) return { answer: "Synthetic draft [S1] [S2].", citedMarkers: ["S1", "S2"], conflicts: [],
    evidence: (user.researchTargets as Array<{ claimIndex: number }>).map(({ claimIndex }) => {
      const option = (user.quoteOptions as Array<{ quoteId: string; marker: string }>).find(item => item.marker === `S${claimIndex % 2 + 1}`)!;
      return { claimIndex, marker: option.marker, quoteId: option.quoteId, support: 0.9,
        statement: ["The authorization contract checks the signature before permitting a transfer.",
          "The settlement service records a confirmed transfer before delivering the paid response.",
          "A transfer requires the authorization contract to validate its signature.",
          "The paid response follows the settlement service's confirmed transfer record.",
          "Checking the signature is a prerequisite for the authorization contract to permit the transfer."][claimIndex] };
    }) };
  return { reviews: (user.evidence as Array<{ index: number }>).map(({ index }) => ({
    index, supportedFact: "The exact quote describes the mechanism.", support: 0.9, statementSupport: 0.9 })) };
}
function provider(mode: "success" | "failure2" | "truncated2" | "malformed2" | "mixed" | "oversized" | "duplicate-review" | "missing-fifth" = "success") {
  let call = 0;
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)), user = JSON.parse(body.messages[1].content), index = ++call;
    if (index === 2 && mode === "failure2") return new Response("PRIVATE_PROVIDER_BODY", { status: 503 });
    const result = replies(user, index);
    if (index === 2 && mode === "mixed") {
      const generation = result as { evidence: object[] };
      generation.evidence.push({ claimIndex: 0, marker: "S1", quoteId: "foreign-quote", support: 0.9, statement: "An unsupported statement." });
    }
    if (index === 2 && mode === "oversized") {
      const generation = result as { evidence: object[] };
      generation.evidence = Array.from({ length: 32 }, () => ({ ...generation.evidence[0] }));
    }
    if (index === 2 && mode === "missing-fifth") {
      const generation = result as { evidence: Array<{ claimIndex: number }> };
      generation.evidence = generation.evidence.filter(row => row.claimIndex !== 4);
    }
    if (index === 3 && mode === "duplicate-review") {
      const review = result as { reviews: object[] }; review.reviews[1] = review.reviews[0];
    }
    const malformed = index === 2 && (mode === "truncated2" || mode === "malformed2");
    return new Response(JSON.stringify({ choices: [{ message: { content: malformed ? '{"answer":"unfinished' : JSON.stringify(result) },
      finish_reason: index === 2 && mode === "truncated2" ? "length" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 100 } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch); return fetch;
}

describe("explicit same-original continuation engine", () => {
  it("requires complete independent support for all five retained mandatory targets with only two sources", async () => {
    const value = await admittedFixture(true), fetch = provider();
    await completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key");
    expect(fetch).toHaveBeenCalledTimes(3);
    const run = policy.prepare.mock.calls[0][1] as QueryRun;
    expect(run.subClaims).toEqual(value.binding.packet.input.targets);
    expect(run.originalFulfillment!.statements.map(row => row.claimIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(run.claimCoverage!.map(row => row.coverage)).toEqual([0.9, 0.9, 0.9, 0.9, 0.9]);
    expect(fetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)).max_tokens)).toEqual([2816, 8192, 2304]);
  });
  it("refuses a missing fifth mandatory target before reserving the independent review", async () => {
    const value = await admittedFixture(true), fetch = provider("missing-fifth");
    await expect(completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key"))
      .rejects.toThrow("synthesize incomplete-review");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(policy.prepare).not.toHaveBeenCalled();
    expect(policy.diagnostic).toHaveBeenCalledWith(value.capability, { phase: "synthesize", category: "incomplete-review" });
  });
  it("prepares the same claim with complete independent review, original timing and no new order/payment", async () => {
    const value = await admittedFixture(), fetch = provider();
    const result = await completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key");
    expect(result).toMatchObject({ prepared: true, selectedSources: 2, reviewedStatements: 2, newModelCalls: 3,
      combinedReservedMicroUsd: 139960, paidDeliveryObligation: "unresolved", payments: 0, searches: 0 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(policy.model.mock.calls.map(call => call[1])).toEqual(["sufficiency", "synthesize", "review"]);
    const run = policy.prepare.mock.calls[0][1] as QueryRun;
    expect(run.id).toBe(value.claim.authority.original.queryId); expect(run.originalFulfillment!.claimId).toBe(value.claim.claimId);
    expect(run.durationMs).toBe(Date.parse(fixtureNow) - Date.parse(value.order.startedAt!));
    expect(run.originalFulfillment!.statements).toHaveLength(2);
    expect(run.totalSpent).toBe(0); expect(run.totalToCreators).toBe(0);
    expect(value.db.claimA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
    expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
    expect(policy.close).toHaveBeenCalledWith(value.capability); expect(policy.diagnostic).not.toHaveBeenCalled();
  });
  it("uses 8192 only for continuation generation while ordinary synthesis and reviewer budgets stay unchanged", async () => {
    const value = await admittedFixture(), fetch = provider();
    await completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key");
    const bodies = fetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(bodies.map(body => body.max_tokens)).toEqual([2048, 8192, 1536]);
    class Ordinary extends JsonChatEngine {
      readonly name = "synthetic-no-network";
      tokens = 0;
      protected async chatJson(_model: string, _system: string, _user: string, tokens = 2048) { this.tokens = tokens; return {}; }
    }
    const ordinary = new Ordinary();
    await ordinary.synthesize({ question: value.binding.authority.question, subClaims: value.packet.input.targets, gathered: value.packet.gathered });
    expect(ordinary.tokens).toBe(2560);
  });
  it.each(["failure2", "truncated2", "malformed2"] as const)("retains a safe synthesis category after %s without a third request", async mode => {
    const value = await admittedFixture(), fetch = provider(mode);
    await expect(completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key"))
      .rejects.toThrow(mode === "failure2" ? "synthesize transport" : "synthesize output-validation");
    expect(fetch).toHaveBeenCalledTimes(2); expect(policy.prepare).not.toHaveBeenCalled();
    expect(policy.model.mock.calls.map(call => call[1])).toEqual(["sufficiency", "synthesize"]);
    expect(policy.diagnostic).toHaveBeenCalledWith(value.capability, { phase: "synthesize", category: mode === "failure2" ? "transport" : "output-validation" });
    expect(JSON.stringify(policy.diagnostic.mock.calls)).not.toContain("PRIVATE_PROVIDER_BODY");
    expect(policy.close).toHaveBeenCalledWith(value.capability);
  });
  it.each(["mixed", "oversized"] as const)("rejects %s proposal packets before reserving review rather than accepting a subset", async mode => {
    const value = await admittedFixture();
    if (mode === "oversized") value.binding.packet.gathered[0].sourceName = "S".repeat(1000);
    const fetch = provider(mode);
    await expect(completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key"))
      .rejects.toThrow("synthesize incomplete-review");
    expect(fetch).toHaveBeenCalledTimes(2); expect(policy.prepare).not.toHaveBeenCalled();
    expect(policy.model.mock.calls.map(call => call[1])).toEqual(["sufficiency", "synthesize"]);
    expect(policy.diagnostic).toHaveBeenCalledWith(value.capability, { phase: "synthesize", category: "incomplete-review" });
  });
  it("does not convert a swallowed malformed review into complete delivery", async () => {
    const value = await admittedFixture(), fetch = provider("duplicate-review");
    await expect(completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key"))
      .rejects.toThrow("review output-validation");
    expect(fetch).toHaveBeenCalledTimes(3); expect(policy.prepare).not.toHaveBeenCalled();
    expect(policy.diagnostic).toHaveBeenCalledWith(value.capability, { phase: "review", category: "output-validation" });
  });
});
