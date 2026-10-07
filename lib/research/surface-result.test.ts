import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { exportsFromCheckedReceipt } from "./receipt-exports";
import { describe, expect, it } from "vitest";
import { a2aResponseFromRun } from "../a2a/result";
import { quoteA2aResearch } from "../a2a/pricing";
import { keryxMeta } from "../openai-compat";
import { remoteResearchResult } from "../mcp/remote-server";
import type { QueryRun } from "../types";
import { surfaceResearch } from "./surface-result";
import type { ReasoningAttempt } from "../llm/reasoning-engine";

function attempt(overrides: Partial<ReasoningAttempt> = {}): ReasoningAttempt {
  return { step: "decide", engine: "llm:deepseek:recorded-model", tier: 0, attempt: 1,
    startedAt: 100, durationMs: 10, outcome: "served", ...overrides };
}

export function fixture(): QueryRun {
  const identity = { sourceKind: "public-reference" as const, itemId: "article-1", itemTitle: "Observed paper",
    itemUrl: "https://example.org/paper", contentVersion: "sha256:observed" };
  return { id: "run", question: "Question?", budget: 0.03, engine: "heuristic", answer: "Evidence [P1]",
    subClaims: ["Recorded claim"], decisions: [], citations: [{ ...identity, marker: "P1", sourceId: "public:paper",
      sourceName: "Publisher", weight: 1, reward: 0, rationale: "Actual public evidence" }],
    evidence: [{ ...identity, claimIndex: 0, claim: "Recorded claim", marker: "P1", sourceId: "public:paper",
      sourceName: "Publisher", quote: "Exact original quote", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false }],
    totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-01T00:00:00Z", paymentMode: "real" };
}

describe("research surface parity", () => {
  it("retains typed request-local refusal metadata on the one shared bounded reasoning contract", () => {
    const run = fixture(); run.engine = "llm:deepseek:recorded-model";
    run.reasoningAttempts = [attempt({ outcome: "failed", error: "output_validation" }),
      attempt({ engine: "llm:cloudflare:recorded-model", tier: 1, outcome: "input-limited", error: "input_limit",
        inputBounds: { promptUtf8Bytes: 25000, requestedOutputTokens: 8192, maximumCombinedUnits: 23000 } }),
      attempt({ engine: "heuristic", tier: 2 })];
    for (const result of [surfaceResearch(run), remoteResearchResult(run), keryxMeta(run),
      a2aResponseFromRun(run, quoteA2aResearch(0.03, "deep"))]) {
      expect(result.reasoningAttempts).toEqual(run.reasoningAttempts);
      expect(result.reasoning).toMatchObject({ telemetry: "recorded", attemptsOmitted: 0,
        sourceSelection: { state: "heuristic", servingEngines: ["heuristic"], fallbackUsed: true } });
      expect(result).not.toHaveProperty("reasoningTelemetry"); expect(result).not.toHaveProperty("reasoningServing");
    }
  });

  it("exposes actual heuristic source selection despite a model aggregate label and other model-served steps", () => {
    const run = fixture(); run.engine = "llm:deepseek:recorded-model";
    run.reasoningAttempts = [attempt({ step: "decompose" }),
      attempt({ outcome: "circuit-open", attempt: 0, durationMs: 0, retryAfterMs: 5000 }),
      attempt({ engine: "llm:cloudflare:recorded-model", tier: 1, outcome: "failed", status: 413, error: "invalid_request" }),
      attempt({ engine: "heuristic", tier: 2 })];
    for (const result of [surfaceResearch(run), remoteResearchResult(run), keryxMeta(run),
      a2aResponseFromRun(run, quoteA2aResearch(0.03, "deep"))]) {
      expect(result.reasoningAttempts).toEqual(run.reasoningAttempts);
      expect(result.reasoning.telemetry).toBe("recorded");
      expect(result.reasoning.sourceSelection).toMatchObject({ state: "heuristic", servingEngines: ["heuristic"], fallbackUsed: true });
      expect(result.reasoning.steps.find(step => step.step === "decompose")).toMatchObject({ state: "model", fallbackUsed: false });
    }
    expect(remoteResearchResult(run).engine).toBe(run.engine);
  });

  it("retains mixed serving across repeated and overlapping steps without selecting the last provider as sole authority", () => {
    const run = fixture();
    run.reasoningAttempts = [attempt({ engine: "heuristic", tier: 2, startedAt: 200 }),
      attempt({ step: "synthesize", startedAt: 150 }), attempt({ startedAt: 100 }),
      attempt({ step: "sufficiency", engine: "llm:mimo:recorded-model", tier: 1, startedAt: 120 }),
      attempt({ step: "sufficiency", startedAt: 130 })];
    const original = JSON.stringify(run.reasoningAttempts), result = surfaceResearch(run);
    expect(result.reasoning.sourceSelection).toMatchObject({ state: "mixed", servingEngines: ["heuristic", "llm:deepseek:recorded-model"], fallbackUsed: true });
    expect(result.reasoning.steps.find(step => step.step === "sufficiency")).toMatchObject({ state: "model", servingEngines: ["llm:mimo:recorded-model", "llm:deepseek:recorded-model"], fallbackUsed: true });
    expect(JSON.stringify(run.reasoningAttempts)).toBe(original);
  });

  it("keeps historical or missing selection telemetry unknown instead of inferring it from engine or another step", () => {
    const run = fixture(); run.engine = "llm:deepseek:historical-model";
    for (const reasoningAttempts of [undefined, [], [attempt({ step: "decompose" })]]) {
      run.reasoningAttempts = reasoningAttempts;
      const result = remoteResearchResult(run);
      expect(result.engine).toBe(run.engine);
      expect(result.reasoning.sourceSelection).toMatchObject({ state: "unknown", servingEngines: [], fallbackUsed: null });
    }
  });

  it("allowlists public attempt fields and marks malformed records incomplete without exposing private data", () => {
    const run = fixture();
    run.reasoningAttempts = [Object.assign(attempt(), { prompt: "PRIVATE_PROMPT", providerBody: "PRIVATE_BODY" }),
      Object.assign(attempt({ durationMs: -1 }), { exception: "PRIVATE_EXCEPTION" })];
    const result = surfaceResearch(run);
    expect(result.reasoningAttempts).toEqual([attempt()]);
    expect(result.reasoning).toMatchObject({ telemetry: "incomplete", attemptsOmitted: 1,
      sourceSelection: { state: "unknown", fallbackUsed: null } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|providerBody|prompt|exception/);
    expect(result.citations).toHaveLength(1);
  });

  it("withholds model-only selection certainty when a bounded prefix omits a later heuristic attempt", () => {
    const run = fixture();
    run.reasoningAttempts = [...Array.from({ length: 256 }, (_, startedAt) => attempt({ startedAt })),
      attempt({ engine: "heuristic", tier: 2, startedAt: 257 })];
    const result = surfaceResearch(run);
    expect(result.reasoningAttempts).toHaveLength(256);
    expect(result.reasoning).toMatchObject({ telemetry: "incomplete", attemptsOmitted: 1,
      sourceSelection: { state: "unknown", servingEngines: ["llm:deepseek:recorded-model"], fallbackUsed: null } });
    expect(run.reasoningAttempts).toHaveLength(257);
  });

  it("retains bounded claim policy and creator-free provenance through shared transports and portable receipts", () => {
    const run = fixture(), policy = { id: "a".repeat(64), revision: 3, mode: "free" as const,
      verifiedAt: "2026-10-01T00:00:00.000Z", effectiveAt: "2026-10-01T00:00:00.000Z" };
    for (const record of [run.citations[0], run.evidence![0]]) {
      delete record.sourceKind;
      Object.assign(record, { sourceId: "owned", sourceClaim: { ...policy, privateNonce: "MUST_NOT_EXPORT" }, accessKind: "creator-free" });
    }
    for (const result of [surfaceResearch(run), remoteResearchResult(run), keryxMeta(run),
      a2aResponseFromRun(run, quoteA2aResearch(0.03, "deep"))]) {
      expect(result.citations[0]).toMatchObject({ sourceClaim: policy, accessKind: "creator-free" });
      expect(result.evidence[0]).toMatchObject({ sourceClaim: policy, accessKind: "creator-free", qualifiesForReward: false });
      expect(JSON.stringify(result)).not.toContain("MUST_NOT_EXPORT");
    }
    const receipt = buildResearchReceipt(run, []);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    expect(receipt.payload.citations[0]).toMatchObject({ sourceClaim: policy, accessKind: "creator-free" });
    expect(receipt.payload.claims[0].evidence[0]).toMatchObject({ sourceClaim: policy, accessKind: "creator-free" });
    expect(JSON.stringify(receipt)).not.toContain("MUST_NOT_EXPORT");
  });
  it("does not obstruct saved-run recovery or fabricate a missing claim ledger", () => {
    const run = fixture();
    delete (run as Partial<QueryRun>).subClaims;
    run.evidence = undefined;
    run.claimCoverage = undefined;
    const result = a2aResponseFromRun(run, quoteA2aResearch(0.03, "deep"));
    expect(result.subClaims).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.answer).toBe(run.answer);
    expect(result.researchExports.evidenceCsv).not.toContain("Recorded claim");
    expect(result.researchExports.bibtex.count).toBe(1);
    expect(result.creatorsPaid).toBeNull();
  });
  it("retains public article identity, answer evidence and reusable exports on all transports", () => {
    const run = fixture();
    for (const result of [surfaceResearch(run), remoteResearchResult(run), keryxMeta(run),
      a2aResponseFromRun(run, quoteA2aResearch(0.03, "deep"))]) {
      expect(result.citations[0]).toMatchObject({ marker: "P1", itemUrl: "https://example.org/paper", rewardPlannedUsdc: 0 });
      expect(result.evidence[0]).toMatchObject({ qualifiesForAnswer: true, qualifiesForReward: false, itemId: "article-1" });
      expect(result.researchExports.bibtex.count).toBe(1);
      expect(result.researchExports.ris.content).toContain("TI  - Observed paper");
      expect(result.researchExports.evidenceCsv).toContain("Exact original quote");
      expect(result.creatorsPaid).toBeNull();
      expect(result.creatorRewardAllocations).toBe(0);
      expect(result.creatorsReferenced).toBe(1);
    }
  });

  it("matches actual receipt-derived scholarly exports without enrichment", () => {
    const run = fixture();
    run.citations[0].scholarly = { provider: "crossref", recordUrl: "https://api.crossref.org/works/10.1234/example", retrievedAt: run.createdAt, title: "Observed paper", authors: ["Recorded Author"], workType: "journal-article", peerReview: "unknown", doi: "10.1234/example", evidenceScope: "publisher-page" };
    const receipt = buildResearchReceipt(run, []);
    expect(exportsFromCheckedReceipt(receipt)).toEqual(surfaceResearch(run).researchExports);
    expect(exportsFromCheckedReceipt(receipt).bibtex.content).toContain("10.1234/example");
  });

  it("preserves preprint RIS identity and literal notes across hosted and checked-receipt exports", () => {
    const run = fixture();
    for (const record of [run.citations[0], run.evidence![0]]) Object.assign(record, {
      sourceId: "public:arxiv", sourceName: "Source <b>literal</b> & research", itemId: "1706.03762v7",
      itemUrl: "https://arxiv.org/abs/1706.03762v7", contentVersion: "v7",
    });
    run.citations[0].scholarly = { provider: "arxiv", recordUrl: "https://export.arxiv.org/api/query",
      retrievedAt: run.createdAt, title: "Observed paper", authors: [], workType: "preprint", peerReview: "unknown",
      arxivId: "1706.03762v7", evidenceScope: "abstract-page" };
    const original = JSON.stringify(run), receipt = buildResearchReceipt(run, []);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    const expected = surfaceResearch(run).researchExports;
    for (const output of [remoteResearchResult(run), keryxMeta(run), a2aResponseFromRun(run, quoteA2aResearch(0.03, "deep"))]) {
      expect(output.researchExports).toEqual(expected);
      expect(output.researchExports.ris.content).toContain("TY  - MANSCPT");
      expect(output.researchExports.ris.content).toContain("AN  - arXiv:1706.03762v7");
      expect(output.researchExports.ris.content).toContain("Source &lt;b&gt;literal&lt;/b&gt; &amp; research");
      expect(output.researchExports.ris.content).toContain("Read scope: abstract-page. Preprint. Peer review unknown");
    }
    expect(exportsFromCheckedReceipt(receipt)).toEqual(expected);
    expect(JSON.stringify(run)).toBe(original);
  });

  it("refuses mismatched and unbounded excerpts and strips unexpected internal fields", () => {
    const run = fixture();
    run.evidence = [run.evidence![0], { ...run.evidence![0], contentVersion: "other" },
      { ...run.evidence![0], itemId: "other" }, { ...run.evidence![0], quote: "x".repeat(241) }];
    Object.assign(run.citations[0], { privateKey: "secret", plaintext: "gated body" });
    Object.assign(run.evidence[0], { privateKey: "secret" });
    const result = surfaceResearch(run);
    expect(result.evidence).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/secret|gated body|privateKey/);
  });
});


it("demotes synthetic evidence across A2A, remote MCP, OpenAI and receipt exports", () => {
  const run = fixture(); run.citations[0].evidenceProvenance = "synthetic-demo";
  run.evidence![0].evidenceProvenance = "synthetic-demo";
  run.answer = "Synthetic empirical benchmark median 178ms p95 240ms [P1].";
  run.claimCoverage = [{ claimIndex: 0, claim: "Recorded claim", coverage: 0.8, coveredBy: ["P1"] }];
  for (const result of [remoteResearchResult(run), a2aResponseFromRun(run, quoteA2aResearch(0.03, "deep"))]) {
    expect(result.answer).toContain("Illustrative demo content");
    expect(result.citations[0].evidenceProvenance).toBe("synthetic-demo");
    expect(result.evidence[0].qualifiesForAnswer).toBe(false);
    expect(result.claimCoverage[0]).toMatchObject({ coverage: 0, coveredBy: [] });
    expect(result.paymentMode).toBe("real");
  }
  expect(keryxMeta(run).evidence[0].qualifiesForAnswer).toBe(false);
  expect(keryxMeta(run).researchExports.bibtex.content).toContain("ILLUSTRATIVE SYNTHETIC DEMO");
});
