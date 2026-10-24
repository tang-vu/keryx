import { afterEach, expect, it, vi } from "vitest";
import { capturePricePolicy } from "../economics/provider-cost-policy";
import { recordedJobObservations } from "./observations";
import { deliveredResearchDigest, issueFeedbackToken, privateRequesterObservations, verifyFeedbackToken } from "./service";
import { binding, secret, opinionFixture, recordedRun } from "./test-fixture";

const fixtures: ReturnType<typeof opinionFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
const fixture = () => { const f = opinionFixture(); fixtures.push(f); return f; };

it("issues only after matching durable completion, without changing the original or giving main-store write authority", async () => {
  const f = fixture(), run = recordedRun(), before = structuredClone(run), reader = { getQueryRun: vi.fn(async () => structuredClone(run)) };
  const packet = await privateRequesterObservations({ run, db: reader, store: () => f.store, publicOriginal: true, binding, secret });
  expect(packet?.feedback).not.toBeNull();
  const capability = verifyFeedbackToken(packet!.feedback!.token, binding, secret);
  expect(capability).toMatchObject({ storeId: f.store.storeId, runId: run.id, deliveredDigest: deliveredResearchDigest(run), observations: packet!.observations });
  expect(JSON.stringify(run)).not.toContain(packet!.feedback!.token);
  expect(run).toEqual(before);
});

it("keeps missing, changed, private, paid-original and planning-failed completions from acquiring feedback capabilities", async () => {
  const f = fixture(), run = recordedRun(), store = vi.fn(() => f.store);
  for (const value of [null, { ...run, answer: "Changed stored original" }]) {
    const packet = await privateRequesterObservations({ run, db: { getQueryRun: async () => value }, store, publicOriginal: true, binding, secret });
    expect(packet?.feedback).toBeNull();
  }
  expect(store).not.toHaveBeenCalled();
  for (const id of ["prv_original", `a2a_${"1".repeat(64)}`]) {
    expect(await privateRequesterObservations({ run: { ...run, id }, db: { getQueryRun: async () => run }, store, publicOriginal: true, binding, secret })).toBeNull();
  }
  expect(await privateRequesterObservations({ run, db: { getQueryRun: async () => run }, store, publicOriginal: false, binding, secret })).toBeNull();
  const failed = { ...run, planningFailure: { version: 1 as const, stage: "decompose" as const, reason: "needs_refinement" as const,
    maximumTargets: 8 as const, automaticRetry: false as const } };
  const reader = vi.fn(async () => failed);
  expect(await privateRequesterObservations({ run: failed, db: { getQueryRun: reader }, store, publicOriginal: true, binding, secret })).toBeNull();
  expect(reader).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled();
});

it("does not open optional metadata when a pending saved-original read completes after abort", async () => {
  const run = recordedRun(), abort = new AbortController(), store = vi.fn(() => fixture().store);
  let release: (value: ReturnType<typeof recordedRun>) => void;
  const saved = new Promise<ReturnType<typeof recordedRun>>(resolve => { release = resolve; });
  const pending = privateRequesterObservations({ run, db: { getQueryRun: () => saved }, store, publicOriginal: true, binding, secret, signal: abort.signal });
  abort.abort(); release!(run);
  const packet = await pending;
  expect(packet?.feedback).toBeNull(); expect(store).not.toHaveBeenCalled();
  expect(packet?.observations.generationDurationMs).toBe(run.durationMs);
});

it("retains observations when optional storage or authentication is unavailable and never retries research", async () => {
  const run = recordedRun();
  for (const options of [{ store() { throw new Error("Unavailable observer metadata"); }, secret }, { store: () => fixture().store, secret: "" }]) {
    const packet = await privateRequesterObservations({ run, db: { getQueryRun: async () => run }, publicOriginal: true, binding, ...options });
    expect(packet?.feedback).toBeNull(); expect(packet?.observations.generationDurationMs).toBe(1250);
  }
});

it("binds origin, network, store, expiry and exact content; bearer tampering and purpose confusion fail", () => {
  const f = fixture(), run = recordedRun(), now = 1792800000000;
  const issued = issueFeedbackToken(run, binding, secret, f.store.storeId, now);
  expect(verifyFeedbackToken(issued.token, binding, secret, now).storeId).toBe(f.store.storeId);
  expect(() => verifyFeedbackToken(issued.token + "x", binding, secret, now)).toThrow("feedback_unauthenticated");
  expect(() => verifyFeedbackToken(issued.token, { ...binding, origin: "https://another.invalid" }, secret, now)).toThrow();
  expect(() => verifyFeedbackToken(issued.token, { ...binding, network: "eip155:5042" }, secret, now)).toThrow();
  expect(() => verifyFeedbackToken(issued.token, binding, secret, Date.parse(issued.expiresAt))).toThrow();
  expect(() => verifyFeedbackToken(issued.token, binding, secret, now - 1)).toThrow();
  expect(() => verifyFeedbackToken(issued.token, binding, secret + "rotated", now)).toThrow();
  expect(() => verifyFeedbackToken("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjYWxsZXIifQ.signature", binding, secret, now)).toThrow();
  expect(issued.token).not.toContain(secret);
});

it("uses captured per-job model bounds and retains failed, pending and unknown costs", () => {
  const run = recordedRun();
  run.llmUsage = [{ callId: "priced", engine: "llm:deepseek:deepseek-flash", model: "deepseek-flash", stage: "sufficiency",
    inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100,
    costCapture: { provider: "deepseek", requestStartedAt: "2026-10-19T10:00:00Z", responseReceivedAt: "2026-10-19T10:00:01Z",
      pricing: capturePricePolicy("deepseek", "deepseek-flash") } }];
  run.llmCalls = [{ id: "priced", engine: run.engine, outcome: "returned", stage: "sufficiency" },
    { id: "failed", engine: run.engine, outcome: "failed" }, { id: "pending", engine: run.engine, outcome: "pending" }];
  const result = recordedJobObservations(run);
  expect(result).toMatchObject({ generationDurationMs: 1250, recordedCalls: 3, failedCalls: 1, pendingCalls: 1, missingUsageCalls: 2,
    costBasis: "partial-captured-policy-estimate", invoice: null, profit: null });
  expect(result.modelCostUsd!.lower).toBeCloseTo(.0001806); expect(result.modelCostUsd!.upper).toBeCloseTo(.0003612);
  expect(recordedJobObservations({ ...run, durationMs: undefined, llmCalls: undefined, llmUsage: undefined })).toMatchObject({ generationDurationMs: null, modelCostUsd: null });
});
