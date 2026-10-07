import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeOriginalContinuation, preflightOriginalContinuation } from "./continue-original";
import { JsonChatEngine } from "../llm/json-chat-engine";
import { evidenceContext } from "../llm/evidence-context";
import { reasoningInput } from "./fulfill-original";
import { ORIGINAL_FULFILLMENT_LIMITS } from "./failed-original-fulfillment-protocol";
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
  it.each(["low", "unbound"] as const)("retains a successful %s fifth assessment and stops before generation or review", async mode => {
    const value = await admittedFixture(true);
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const wire = JSON.parse(String(init?.body));
      const assessment = replies(JSON.parse(wire.messages[1].content), 1) as { perClaim: Array<{
        coverage: number; coveredBy: string[]; missingRequestedParts: string[];
      }> };
      assessment.perClaim[4].coverage = mode === "low" ? 0.1 : 0.9;
      assessment.perClaim[4].coveredBy = mode === "unbound" ? [] : ["S1"];
      assessment.perClaim[4].missingRequestedParts = ["Synthetic deployment and delivery checks remain unverified."];
      return Response.json({ choices: [{ message: { content: JSON.stringify(assessment) }, finish_reason: "stop" }] });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key"))
      .rejects.toThrow("sufficiency quality");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(policy.model.mock.calls.map(call => call[1])).toEqual(["sufficiency"]);
    // The valid negative assessment completed the checkpoint action, rather than
    // being classified as a failed provider output or silently replaced.
    expect(await policy.model.mock.results[0].value).toMatchObject({ perClaim: [
      {}, {}, {}, {}, { coverage: mode === "low" ? 0.1 : 0.9,
        missingRequestedParts: ["Synthetic deployment and delivery checks remain unverified."] },
    ] });
    expect(policy.diagnostic).toHaveBeenCalledTimes(1);
    expect(policy.diagnostic).toHaveBeenCalledWith(value.capability, { phase: "sufficiency", category: "quality" });
    expect(policy.prepare).not.toHaveBeenCalled();
    expect(policy.close).toHaveBeenCalledWith(value.capability);
    expect(value.db.claimA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
    expect(value.db.completeA2aFailedOriginalFulfillment).not.toHaveBeenCalled();
  });

  it("uses complete selected bodies through preflight, generation binding and independent review while retaining partial gaps", async () => {
    const value = await admittedFixture(true);
    const filler = Array.from({ length: 30 }, (_, index) =>
      `Synthetic section ${index} discusses contract-wallet support, EOA payment flow, authorization, revocation limits and acceptance checks.`).join("\n");
    const facts = [
      "The synthetic contract uses contractSigner:true with a contract signature.",
      "The synthetic vendor returns 402 before EIP-3009 signing, a retry, signature verification and item delivery.",
      "The synthetic enclave asks a two-of-three RPC quorum for the recent validation result.",
      "The synthetic TEE runs isValidSignature in read-only mode and forbids state changes.",
      "The synthetic batch credits the seller account only after the signatures pass verification.",
    ];
    const bodies = [`${filler}\n${facts[0]}\n${facts[2]}\n${facts[3]}`,
      `${filler}\n${facts[1]}\n${facts[4]}`];
    value.binding.packet.gathered.forEach((source, index) => { source.text = bodies[index]; });
    const input = reasoningInput(value.binding);
    const sampled = evidenceContext(input.question, input.subClaims, input.gathered);
    expect(sampled.every(source => source.excerpted)).toBe(true);
    expect(sampled.flatMap(source => source.passages.map(passage => passage.text)).join("\n")).not.toContain("contractSigner:true");
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const wire = JSON.parse(String(init?.body)), user = JSON.parse(wire.messages[1].content);
      let output: object;
      if (fetch.mock.calls.length === 1) {
        const assessment = replies(user, 1) as { perClaim: Array<{ coverage: number; missingRequestedParts: string[] }> };
        assessment.perClaim[4].coverage = 0.4;
        assessment.perClaim[4].missingRequestedParts = ["Synthetic deployment details and observed delivery receipts remain unverified."];
        output = assessment;
      } else if (fetch.mock.calls.length === 2) {
        output = { answer: "UNREVIEWED_SYNTHETIC_DRAFT [S1] [S2].", citedMarkers: ["S1", "S2"], conflicts: [],
          evidence: facts.map((statement, claimIndex) => {
            const option = (user.quoteOptions as Array<{ text: string; quoteId: string; marker: string }>).find(row => row.text === statement)!;
            expect(option).toBeDefined();
            return { claimIndex, marker: option.marker, quoteId: option.quoteId, support: 0.9, statement };
          }) };
      } else output = replies(user, 3);
      return Response.json({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }] });
    });
    vi.stubGlobal("fetch", fetch);
    const preflight = await preflightOriginalContinuation(value.binding);
    expect(fetch).not.toHaveBeenCalled();
    expect(policy.begin).not.toHaveBeenCalled();
    expect(preflight).toMatchObject({ targets: 5, selectedSources: 2, providerRequests: 0, searches: 0, payments: 0 });
    await completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key");
    expect(fetch).toHaveBeenCalledTimes(3);
    const wires = fetch.mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(wires.slice(0, 2).map(wire => Buffer.byteLength(wire.messages[0].content + wire.messages[1].content)))
      .toEqual(preflight.prompts.map(prompt => prompt.promptUtf8Bytes));
    expect(preflight.prompts.every(prompt => prompt.promptUtf8Bytes <= ORIGINAL_FULFILLMENT_LIMITS.maximumInputBytes)).toBe(true);
    const sufficiency = JSON.parse(wires[0].messages[1].content), generation = JSON.parse(wires[1].messages[1].content);
    for (const sources of [sufficiency.gathered, generation.sources]) {
      expect(sources.map((source: { passages: object[] }) => source.passages)).toEqual(bodies.map(text => [{ start: 0, end: text.length, text }]));
      expect(sources.every((source: { excerpted: boolean; contextOmissions?: unknown; candidateSelection?: unknown }) =>
        source.excerpted === false && source.contextOmissions === undefined && source.candidateSelection === undefined)).toBe(true);
    }
    const review = JSON.parse(wires[2].messages[1].content);
    expect(review.evidence).toHaveLength(5);
    expect(review.evidence.map((row: { quote: string }) => row.quote)).toEqual(facts);
    for (const row of review.evidence) {
      const source = input.gathered.find(source => source.marker === row.source.marker)!;
      expect(source.text.slice(row.quoteSpan.start, row.quoteSpan.end)).toBe(row.quote);
      expect(source.text.slice(row.context.start, row.context.end)).toBe(row.context.text);
      expect(row.context.text.length).toBeLessThanOrEqual(1200);
    }
    const run = policy.prepare.mock.calls[0][1] as QueryRun;
    expect(run.claimCoverage!.map(row => row.coverage)).toEqual([0.9, 0.9, 0.9, 0.9, 0.4]);
    expect(run.originalFulfillment!.statements.map(row => row.claimIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(run.originalFulfillment!.evidenceGaps).toEqual([{ claimIndex: 4,
      missingRequestedParts: ["Synthetic deployment details and observed delivery receipts remain unverified."] }]);
    expect(run.answer).toContain("remain unverified");
    expect(run.answer).not.toContain("UNREVIEWED_SYNTHETIC_DRAFT");
  });

  it("refuses an over-bound complete body in readonly preflight and execution without excerpt fallback or supplier reservation", async () => {
    const value = await admittedFixture(true), fetch = provider();
    value.binding.packet.gathered[0].text = "x".repeat(ORIGINAL_FULFILLMENT_LIMITS.maximumInputBytes);
    await expect(preflightOriginalContinuation(value.binding)).rejects.toThrow("prompt exceeds supplier bounds");
    expect(policy.begin).not.toHaveBeenCalled();
    await expect(completeOriginalContinuation(value.db, "private-authorization", "a".repeat(64), "synthetic-fixture-key"))
      .rejects.toThrow("sufficiency input-limit");
    expect(fetch).not.toHaveBeenCalled();
    expect(policy.model).not.toHaveBeenCalled();
    expect(policy.prepare).not.toHaveBeenCalled();
    expect(policy.diagnostic).toHaveBeenCalledWith(value.capability, { phase: "sufficiency", category: "input-limit" });
    expect(policy.close).toHaveBeenCalledWith(value.capability);
  });

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
