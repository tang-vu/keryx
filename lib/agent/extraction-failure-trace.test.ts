import { expect, it, vi } from "vitest";
import { runAgent } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { ReasoningEngine } from "../llm/reasoning-engine";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import { ArticleReadError } from "../web-research/article-reader";
import { rememberExtractionFailure } from "../web-research/extraction-failure";
import { sourceReadSummary } from "../research/source-read-outcomes";

async function drive(tagged: boolean, privateJob = false) {
  const denied = vi.fn(async () => { throw new Error("No payment is authorized in this synthetic fixture"); });
  const queryId = privateJob ? "prv_extraction_diagnostic_fixture" : "extraction-diagnostic-fixture";
  const effects: ResearchEffects = { scope: privateJob ? { kind: "job", queryId } : { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: denied, saveQueryRun: vi.fn(async () => {}),
    saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const read = vi.fn(async () => {
    const error = new ArticleReadError("html-extraction-unavailable");
    // Only the first read has an actually tagged observation. The second must
    // not inherit it from mutable per-run state. No real network/worker involved.
    if (tagged && read.mock.calls.length === 1) rememberExtractionFailure(error, { format: "html", reason: "worker-exit" });
    Object.defineProperty(error, "message", { value: "NEVER_STORE_PRIVATE_VENDOR_TEXT /system/path" });
    throw error;
  });
  const engine = { name: "synthetic-extraction-observer", decompose: async () => ["What does each requested original establish?"],
    decide: async (input: { candidates: { id: string; name: string }[] }) => input.candidates.map(row => ({ sourceId: row.id, sourceName: row.name,
      action: "CACHE", price: 0, confidence: 0.9, expectedValue: 0.9, targets: [0], rationale: "Controlled exact public read" })),
    sufficiency: async () => ({ sufficient: false, rationale: "No read facts", perClaim: [] }),
    reevaluate: async () => ({ shouldBuyMore: false, recommendedIds: [], rationale: "No extra fixture reads" }),
    synthesize: vi.fn(async () => { throw new Error("No model generation in this failure fixture"); }), attribute: async () => [] } as unknown as ReasoningEngine;
  const deps: AgentDeps = { engine, effects, db: { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB,
    readWebArticle: read, webSearch: { search: vi.fn(async () => []) } as unknown as AgentDeps["webSearch"],
    gateway: { mode: "real", agentAddress: () => "0x0000000000000000000000000000000000000001", ensureFunded: denied, payFetch: denied, payCitation: denied } as unknown as PaymentGateway };
  const iterator = runAgent({ queryId, question: "Inspect https://example.org/a and https://example.org/b and keep missing evidence explicit.", origin: "web", budget: 0,
    researchMode: "deep", executionLimits: { attentionLimit: 2, reevaluateRounds: 0 } }, deps);
  let step = await iterator.next();while (!step.done) step = await iterator.next();
  return { run: step.value, denied, read };
}
it("records the optional safe sibling while preserving the v1 source-read record, counts and monetary state", async () => {
  const baseline = await drive(false), current = await drive(true);
  expect(current.read).toHaveBeenCalledTimes(2);
  const failures = current.run.trace.filter(row => row.phase === "fetch" && row.message.includes("Public page unavailable"));
  expect(failures).toHaveLength(2);
  expect(failures[0].detail).toMatchObject({ sourceRead: { protocol: "keryx-source-read-v1", status: "failed", failureCode: "html-extraction-unavailable" },
    extractionDiagnostic: { format: "html", reason: "worker-exit" } });
  expect(failures[1].detail).not.toHaveProperty("extractionDiagnostic");
  expect((failures[0].detail as { sourceRead: unknown }).sourceRead).not.toHaveProperty("extractionDiagnostic");
  expect(sourceReadSummary(current.run)).toEqual(sourceReadSummary(baseline.run));expect(sourceReadSummary(current.run).failedReads).toBe(2);
  expect(current.run.evidence).toEqual(baseline.run.evidence);expect(current.run.citations).toEqual(baseline.run.citations);
  expect(current.run.totalSpent).toBe(0);expect(current.run.totalToCreators).toBe(0);expect(current.denied).not.toHaveBeenCalled();
  expect(JSON.stringify(current.run.trace)).not.toMatch(/NEVER_STORE|\/system\/path/);
});
it("does not add a public diagnostic contract to private job execution", async () => {
  const f = await drive(true, true);expect(f.read).not.toHaveBeenCalled();
  expect(JSON.stringify(f.run.trace)).not.toContain("extractionDiagnostic");expect(f.denied).not.toHaveBeenCalled();
});
