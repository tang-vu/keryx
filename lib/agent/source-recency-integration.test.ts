import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runAgent, type RunInput } from "./run-agent";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { ReasoningEngine, DecideInput, SynthInput, SufficiencyInput } from "../llm";
import { fetchPublicBytes } from "../net/public-fetch";
import { referenceSnapshot, type PublicReference } from "../public-references/catalog";
import { RECENCY_FEED_URL, recencyAtomEntry, recencyAtomFeed } from "../sources/source-recency-feed-fixtures";
import { surfaceResearch } from "../research/surface-result";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";

vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: vi.fn(), fetchPublicText: vi.fn() }));
const transport = vi.mocked(fetchPublicBytes);
const question = `Name the newest release in ${RECENCY_FEED_URL}, state one change and one missing compatibility fact.`;
const content = "Release new adds an opt-in flag. Older releases did not include that flag.";
function reference(id = "public:release", feedUrl = RECENCY_FEED_URL, includeNew = true): PublicReference {
  return referenceSnapshot({ id, name: "Releases", url: "https://publisher.example.test/", rssUrl: feedUrl,
    description: "Release notes", tags: ["release", "compatibility", "flag"], active: true, items: [] }, {
    items: [{ title: "Release old", summary: "newest release compatibility flag", content,
      link: "https://publisher.example.test/old", publishedAt: "2026-09-01T12:00:00.000Z" },
    ...(includeNew ? [{ title: "Release new", summary: "Release notes", content,
      link: "https://publisher.example.test/new", publishedAt: "2026-10-07T12:00:00.000Z" }] : [])],
  } as Parameters<typeof referenceSnapshot>[1]);
}
function fixture(references = [reference()]) {
  const payment = vi.fn(async () => { throw new Error("Public ordering cannot authorize payment"); });
  const decide = vi.fn(async (input: DecideInput) => input.candidates.map(c => ({ sourceId: c.id,
    sourceName: c.name, action: "CACHE" as const, expectedValue: 0.9, price: 0, confidence: 0.9, targets: [0], rationale: "Read catalog notes" })));
  const synthesize = vi.fn(async (input: SynthInput) => ({ answer: `[${input.gathered[0].marker}]`,
    citedMarkers: [input.gathered[0].marker], evidence: [], conflicts: [] }));
  const engine = { name: "test-recency", decompose: async () => ["Release changes"], decide,
    sufficiency: async (input: SufficiencyInput) => ({ sufficient: true, rationale: "Fixture",
      perClaim: input.subClaims.map(claim => ({ claim, coverage: 0.9, coveredBy: input.gathered.map(g => g.marker) })) }),
    reevaluate: async () => ({ shouldBuyMore: false, recommendedIds: [], rationale: "Fixture" }),
    synthesize, attribute: async () => [] } as unknown as ReasoningEngine;
  const effects: ResearchEffects = { scope: { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: async () => {}, recordPayment: payment,
    saveQueryRun: async () => {}, saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const read = vi.fn(async () => { throw new Error("A native feed must not enter the article reader"); });
  const db = { listSources: async () => [], listPublicReferences: async () => references } as unknown as KeryxDB;
  const gateway = { mode: "real", agentAddress: () => "0x0000000000000000000000000000000000000001",
    ensureFunded: payment, payFetch: payment, payCitation: payment } as unknown as PaymentGateway;
  return { deps: { db, engine, gateway, effects, readWebArticle: read,
    webSearch: { search: async () => [] } as unknown as AgentDeps["webSearch"] } satisfies AgentDeps, payment, decide, synthesize, read };
}
async function drive(deps: AgentDeps, input: Partial<RunInput> = {}) {
  const generator = runAgent({ queryId: "recency-fixture", question, origin: "web", budget: 0, researchMode: "quick", ...input }, deps);
  let row = await generator.next(); while (!row.done) row = await generator.next();
  return row.value;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  transport.mockReset().mockResolvedValue({ bytes: new TextEncoder().encode(recencyAtomFeed(recencyAtomEntry("old", "2026-09-01T12:00:00Z") + recencyAtomEntry("new"))),
    finalUrl: RECENCY_FEED_URL, contentType: "application/atom+xml" }); });
afterEach(() => vi.useRealTimers());

it("selects the exact native newest catalog article before relevance/CACHE and shares only metadata", async () => {
  const f = fixture(), run = await drive(f.deps);
  expect(transport).toHaveBeenCalledOnce(); expect(f.read).not.toHaveBeenCalled(); expect(f.payment).not.toHaveBeenCalled();
  expect(f.decide.mock.calls[0][0].candidates).toHaveLength(1);
  expect(f.decide.mock.calls[0][0].candidates[0].item).toMatchObject({ itemTitle: "Release new", itemUrl: "https://publisher.example.test/new" });
  expect(run.evidencePortfolio?.attentionLimit).toBe(1); expect(run.sourceRecency?.metadataReads).toBe(1);
  expect(run.sourceRecency?.gaps).toEqual([]); expect(run.sourceRecency?.observations).toHaveLength(1);
  expect(JSON.stringify(run.sourceRecency)).not.toContain(content);
  expect(surfaceResearch(run).sourceRecency).toEqual(run.sourceRecency);
  const receipt = buildResearchReceipt(run, []); expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.sourceRecency).toEqual(run.sourceRecency);
});
it("reports the observed unindexed winner and never substitutes the older, more relevant catalog item", async () => {
  const f = fixture([reference("public:release", RECENCY_FEED_URL, false)]), run = await drive(f.deps);
  expect(f.decide).not.toHaveBeenCalled(); expect(f.synthesize).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  expect(f.payment).not.toHaveBeenCalled(); expect(run.sourceRecency?.metadataReads).toBe(1);
  expect(run.sourceRecency?.gaps).toContainEqual(expect.objectContaining({ reason: "newest-entry-not-indexed",
    observation: expect.objectContaining({ newestEntry: expect.objectContaining({ title: "Release new" }) }) }));
  expect(run.answer).toContain("has no exact catalog item"); expect(run.answer).toContain("Release new");
});
it.each([{ origin: "engine" as const }, { executionLimits: { attentionLimit: 2, reevaluateRounds: 0 } },
  { answerFormat: "decision-brief" as const }, { paidScholarly: true },
  { question: question.replace("newest release", "newest stable release") }])("preserves held scopes without any native or article GET: %j", async input => {
  const f = fixture(), run = await drive(f.deps, input);
  expect(transport).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled(); expect(f.payment).not.toHaveBeenCalled();
  if (!("question" in input)) expect(run).not.toHaveProperty("sourceRecency");
});
it("charges a failed metadata probe to the same quick attention cap before unrelated article selection", async () => {
  transport.mockRejectedValue(new Error("Native transport failed"));
  const f = fixture([reference(), reference("public:other1", "https://other.example.test/feed"),
    reference("public:other2", "https://other2.example.test/feed")]), run = await drive(f.deps);
  expect(run.sourceRecency?.metadataReads).toBe(1); expect(run.evidencePortfolio?.attentionLimit).toBe(1);
  expect(run.evidencePortfolio?.selectedAssetIds).toHaveLength(1); expect(transport).toHaveBeenCalledOnce();
  expect(f.payment).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
});
