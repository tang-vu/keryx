import { expect, it, vi } from "vitest";
import { runAgent } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { ReasoningEngine, DecideInput, SufficiencyInput, SynthInput } from "../llm";
import type { KeryxDB } from "../db/keryx-db";
import type { Source } from "../types";
import type { PaymentGateway } from "../payments/payment-gateway";
import { ArticleReadError } from "../web-research/article-reader";
import { sourceReadSummary } from "../research/source-read-outcomes";
import { publicQueryRun } from "../research/public-query-run";

function fixture(cache?: "present" | "missing") {
  const forbidden = vi.fn(async () => { throw new Error("Synthetic forbidden network/payment effect"); });
  const saved = vi.fn(async () => {}), read = vi.fn(async (url: string) => {
    if (url.includes("primary.example")) throw new ArticleReadError("transport-unavailable", { reason: "http-status", httpStatus: 503, elapsedMs: 72 });
    return { text: "A synthetic independent source was read successfully.", title: "Synthetic original", finalUrl: url, kind: "html" as const, truncated: false };
  });
  const effects: ResearchEffects = { scope: { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCachedAt: async () => cache ? new Date().toISOString() : null, getCached: async () => cache === "present" ? "The synthetic retained cache has actual text." : null,
    setCached: forbidden, recordPayment: forbidden, saveQueryRun: saved, saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const source: Source = { id: "owned-cache", name: "Synthetic owned cache", url: "https://cache.example", walletAddress: `0x${"2".repeat(40)}`,
    fetchPrice: 0.001, verified: true, tags: ["synthetic"], description: "Synthetic retained source", authors: [], createdAt: "2026-10-19T00:00:00Z" };
  const db = { listSources: async () => cache ? [source] : [], listPublicReferences: async () => [], getItems: async () => [], getItem: async () => null,
    getArticleOffer: async () => null } as unknown as KeryxDB;
  const engine = { name: "synthetic-no-provider", decompose: async () => ["Synthetic reading target"],
    decide: async (i: DecideInput) => i.candidates.map(c => ({ sourceId: c.id, sourceName: c.name, action: "CACHE", price: 0,
      expectedValue: 0.9, confidence: 0.9, targets: [0], rationale: "Synthetic selected read" })),
    sufficiency: async (i: SufficiencyInput) => ({ sufficient: false, rationale: "Only partial fixture evidence", perClaim: i.subClaims.map(claim => ({ claim, coverage: 0.3, coveredBy: i.gathered.map(g => g.marker) })) }),
    synthesize: vi.fn(async (_i: SynthInput) => ({ answer: "", citedMarkers: [], evidence: [], conflicts: [] })),
    attribute: forbidden, reevaluate: forbidden } as unknown as ReasoningEngine;
  const gateway = { mode: "real", agentAddress: () => `0x${"4".repeat(40)}`, ensureFunded: forbidden, payFetch: forbidden, payCitation: forbidden } as unknown as PaymentGateway;
  const deps: AgentDeps = { db, engine, gateway, effects, readWebArticle: read,
    discoverScholarly: async () => ({ candidates: new Map(), succeeded: 0, unavailable: 0, requestedDois: 0, resolvedDois: 0 }), webSearch: { search: vi.fn(async () => []) } };
  return { deps, read, forbidden, saved };
}
async function finish(f: ReturnType<typeof fixture>, question: string) {
  const gen = runAgent({ question, origin: "web", budget: 0, researchMode: "quick" }, f.deps);
  let next = await gen.next(); while (!next.done) next = await gen.next(); return next.value;
}
it("retains actual failed-original transport facts beside the independently completed public read", async () => {
  const f = fixture(), run = await finish(f, "Compare https://primary.example/manual and https://secondary.example/manual.");
  expect(f.read).toHaveBeenCalledTimes(2); expect(f.forbidden).not.toHaveBeenCalled();
  const publicReport = JSON.parse(JSON.stringify(publicQueryRun(run)));
  expect(sourceReadSummary(publicReport)).toEqual({ publicReads: 1, cacheHits: 0, failedReads: 1, publicSelectionsWithoutOutcome: 0, cacheSelectionsWithoutOutcome: 0 });
  const failure = run.trace.find(t => (t.detail as { sourceRead?: { status: string } } | undefined)?.sourceRead?.status === "failed");
  expect(failure?.detail).toMatchObject({ sourceRead: { kind: "public", failureCode: "transport-unavailable",
    diagnostic: { reason: "http-status", httpStatus: 503, elapsedMs: 72 } } });
  expect(run.totalSpent).toBe(0); expect(run.citations).toEqual([]);
});
it("does not leak a previous source's diagnostic into a later unclassified refusal", async () => {
  const f = fixture();
  f.read.mockImplementation(async url => {
    if (url.includes("primary.example")) throw new ArticleReadError("transport-unavailable", { reason: "http-status", httpStatus: 503, elapsedMs: 72 });
    throw new Error("PRIVATE_VENDOR_ERROR https://source.example/?secret=PRIVATE");
  });
  const run = await finish(f, "Compare https://primary.example/manual and https://secondary.example/manual.");
  const outcomes = run.trace.flatMap(t => (t.detail as { sourceRead?: unknown } | undefined)?.sourceRead ?? []);
  expect(outcomes).toHaveLength(2);
  expect(outcomes[0]).toMatchObject({ diagnostic: { reason: "http-status", httpStatus: 503 } });
  expect(outcomes[1]).not.toHaveProperty("diagnostic");
  expect(JSON.stringify(publicQueryRun(run))).not.toContain("PRIVATE_VENDOR_ERROR");
  expect(f.read).toHaveBeenCalledTimes(2); expect(f.forbidden).not.toHaveBeenCalled();
});
it.each(["present", "missing"] as const)("records an actual %s cache body rather than inferring it from CACHE selection", async cache => {
  const f = fixture(cache), run = await finish(f, "Explain the synthetic retained source.");
  expect(f.read).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  expect(sourceReadSummary(run)).toMatchObject({ publicReads: 0, cacheHits: cache === "present" ? 1 : 0, failedReads: cache === "missing" ? 1 : 0, cacheSelectionsWithoutOutcome: 0 });
  expect(run.totalSpent).toBe(0);
});
