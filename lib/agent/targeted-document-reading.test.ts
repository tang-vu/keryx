import { expect, it, vi } from "vitest";
import { runAgent } from "./run-agent";
import { HeuristicEngine } from "../llm/heuristic-engine";
import { extractHtml } from "../web-research/html-reader";
import type { ArticleReadOptions } from "../web-research/article-reader";
import type { ResearchEffects } from "./research-effects";
import type { AgentDeps } from "./deps";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";

it("carries requested selector intent through the shared agent and reports the observed section scope", async () => {
  const url = "https://docs.example/manual/v2", question = `What retry caveat applies? Use ${url}#limits`;
  const engine = new HeuristicEngine();
  vi.spyOn(engine, "decompose").mockResolvedValue(["What retry caveat applies?"]);
  vi.spyOn(engine, "decide").mockImplementation(async input => input.candidates.map(row => ({ sourceId: row.id, sourceName: row.name,
    action: "BUY" as const, expectedValue: 0.9, confidence: 0.9, price: 0, targets: [0], rationale: "Controlled selection of a synthetic free original" })));
  vi.spyOn(engine, "sufficiency").mockResolvedValue({ sufficient: true, rationale: "Synthetic coverage judgment",
    perClaim: [{ claim: "What retry caveat applies?", coverage: 0.9, coveredBy: ["S1"] }] });
  const deniedPayment = vi.fn(async () => { throw new Error("This zero-budget fixture cannot spend"); });
  const effects: ResearchEffects = { scope: { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: deniedPayment,
    saveQueryRun: vi.fn(async () => {}), saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const read = vi.fn(async (requested: string, signal?: AbortSignal, options?: ArticleReadOptions) => {
    expect(requested).toBe(url); expect(options?.requestedUrls).toEqual([url + "#limits"]);
    return extractHtml(`<html><body><h2 id="limits">Retry caveat</h2><p>${"A retry may duplicate delivery. This synthetic constraint applies only to version two. ".repeat(3)}</p><h2>Unrelated</h2></body></html>`, url, signal, "limits");
  });
  const deps: AgentDeps = { db: { listSources: async () => [], listPublicReferences: async () => [] } as unknown as KeryxDB,
    engine, effects, readWebArticle: read, webSearch: { search: async () => [] },
    gateway: { mode: "offline", agentAddress: "0x0000000000000000000000000000000000000001", ensureFunded: deniedPayment,
      payFetch: deniedPayment, payCitation: deniedPayment } as unknown as PaymentGateway };
  const iterator = runAgent({ question, origin: "web", budget: 0, researchMode: "quick" }, deps);
  const planning: unknown[] = [];
  let item = await iterator.next(); while (!item.done) {
    if (item.value.phase === "decide") planning.push(item.value.detail);
    item = await iterator.next();
  }
  const run = item.value;
  expect(read).toHaveBeenCalledOnce();
  expect(run.answer).toContain("Only heading section `#limits` was read");
  expect(run.answer).not.toContain("not that section specifically");
  expect(run.decisions[0].requestedSource?.readScope).toBe("bounded-heading-section");
  expect(run.decisions[0].webProvenance?.htmlSectionScope?.fragment).toBe("limits");
  expect(JSON.stringify(planning)).toContain("bounded-whole-document");
  expect(JSON.stringify(planning)).not.toContain("bounded-heading-section");
  const receipt = buildResearchReceipt(run, []);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.agency.decisions[0].webProvenance?.htmlSectionScope?.fragment).toBe("limits");
  expect(run.totalSpent).toBe(0); expect(deniedPayment).not.toHaveBeenCalled();
});
