import { expect, it, vi } from "vitest";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { ReasoningEngine, DecideInput } from "../llm";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { Source, SourceItem } from "../types";
import { runAgent } from "./run-agent";
import { ISSUE217_ORIGINAL_QUESTION as question } from "../../test-support/issue-217-request-fixture";

// The full saved request matters: its temporal instruction is not the first sentence.

vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: vi.fn(async () => { throw new Error("Live transport forbidden"); }),
  fetchPublicText: vi.fn(async () => { throw new Error("Live transport forbidden"); }) }));

it("preserves the exact issue217 later temporal instruction before an older creator BUY", async () => {
  const source: Source = { id: "17", name: "Registered release fixture", url: "https://github.com/tang-vu/keryx/releases.atom",
    rssUrl: "https://github.com/tang-vu/keryx/releases.atom", walletAddress: `0x${"22".repeat(20)}`,
    fetchPrice: 0.005, verified: true, tags: ["release"], description: "Synthetic release metadata", authors: [], createdAt: "2026-10-07T00:00:00Z" };
  const older: SourceItem = { id: "fixture-v10", sourceId: source.id, title: "Release compatibility deployment change startup",
    summary: "Newest release tag actually present in the feed, one explicit change, compatibility deployment fact, registered creator payment outcomes.",
    content: "Inert old fixture body.", link: "https://github.com/tang-vu/keryx/releases/tag/v0.27.10", publishedAt: "2026-10-06T18:11:41.000Z" };
  const newer: SourceItem = { ...older, id: "fixture-v18", title: "v0.27.18", summary: "New entry",
    link: "https://github.com/tang-vu/keryx/releases/tag/v0.27.18", publishedAt: "2026-10-07T15:55:05.000Z" };
  const catalog = vi.fn(async () => [newer, older]);
  const decide = vi.fn(async (input: DecideInput) => input.candidates.map(c => ({ sourceId: c.id, sourceName: c.name,
    action: "BUY" as const, expectedValue: 0.9, price: c.fetchPrice, confidence: 0.9, targets: [0], rationale: "Synthetic older metadata overlap" })));
  // This records attempted article admission, then refuses; it cannot fabricate settlement.
  const buy = vi.fn(async () => { throw new Error("Payment forbidden in this fixture"); });
  const funding = vi.fn(async () => ({ address: `0x${"11".repeat(20)}` }));
  const forbidden = vi.fn(async () => { throw new Error("Unexpected external effect"); });
  const effects: ResearchEffects = { scope: { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => null, getCachedAt: async () => null, setCached: forbidden, recordPayment: forbidden,
    saveQueryRun: async () => {}, saveMemory: async () => {}, notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const db = { listSources: async () => [source], listPublicReferences: async () => [], getItems: catalog,
    getItem: async (_sourceId: string, id: string) => [newer, older].find(item => item.id === id) ?? null,
    getArticleOffer: async () => null } as unknown as KeryxDB;
  const engine = { name: "inert-issue217-fixture", decompose: async () => ["release compatibility deployment change startup"], decide,
    sufficiency: async () => ({ sufficient: true, rationale: "Inert fixture", perClaim: [] }),
    synthesize: forbidden, attribute: forbidden } as unknown as ReasoningEngine;
  const gateway = { mode: "real", agentAddress: () => `0x${"11".repeat(20)}`, ensureFunded: funding,
    payFetch: buy, payCitation: forbidden } as unknown as PaymentGateway;
  const deps: AgentDeps = { db, engine, gateway, effects, readWebArticle: forbidden,
    webSearch: { search: async () => [] } as unknown as AgentDeps["webSearch"] };
  const generator = runAgent({ queryId: "inert-issue217-fixture", question, origin: "web", budget: 0.1, researchMode: "quick" }, deps);
  let row = await generator.next(); while (!row.done) row = await generator.next();
  expect(buy).not.toHaveBeenCalled();
  expect(funding).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
  expect(decide).not.toHaveBeenCalled();
  expect(forbidden).not.toHaveBeenCalled();
  expect(row.value.answer).toContain("Newest-release limitation");
  expect(row.value.sourceRecency).toMatchObject({ metadataReads: 0, observations: [],
    gaps: expect.arrayContaining([expect.objectContaining({ sourceId: source.id, feedUrl: source.rssUrl, reason: "unsupported-temporal-form" })]) });
  expect(row.value.totalSpent).toBe(0);
  expect(row.value.totalToCreators).toBe(0);
});
