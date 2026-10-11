import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentDeps } from "./deps";
import type { ResearchEffects } from "./research-effects";
import type { KeryxDB } from "../db/keryx-db";
import type { ReasoningEngine, DecideInput, SynthInput } from "../llm";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { Source, SourceItem } from "../types";
import { runAgent } from "./run-agent";
import { fetchPublicBytes } from "../net/public-fetch";
import { selectRelevantSourceItem } from "../sources/source-item-asset";
import releases from "../sources/fixtures/issue-217-retained-releases.json";
import { ISSUE217_ORIGINAL_QUESTION as question } from "../../test-support/issue-217-request-fixture";

// Exact saved caller text; synthetic native XML and registered creator catalog, not a
// captured feed, paid body, current publisher metadata or real registry enrollment.
vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: vi.fn(),
  fetchPublicText: vi.fn(async () => { throw new Error("Live transport forbidden"); }) }));
const transport = vi.mocked(fetchPublicBytes);
const feed = "https://github.com/tang-vu/keryx/releases.atom";
const source: Source = { id: "17", name: "Registered release fixture", url: feed, rssUrl: feed,
  walletAddress: `0x${"22".repeat(20)}`, fetchPrice: 0.005, verified: true, tags: ["release"],
  description: "Synthetic release metadata", authors: [], createdAt: "2026-10-07T00:00:00Z" };
const subClaims = ["release compatibility deployment change startup"];
const items: SourceItem[] = releases.items.map(row => ({ id: `fixture-${row.itemId}`, sourceId: source.id,
  title: row.itemTitle, summary: row.itemId === "v10"
    ? "Newest release tag actually present in the feed, one explicit change, compatibility deployment fact, registered creator payment outcomes."
    : "New entry", content: "Inert fixture body. Not live release evidence.",
  link: `https://github.com/tang-vu/keryx/releases/tag/v0.27.${row.itemId.slice(1)}`, publishedAt: row.itemPublishedAt }));
const newer = items.find(item => item.id === "fixture-v18")!;
const older = items.find(item => item.id === "fixture-v10")!;
const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><id>urn:synthetic:issue217</id><link rel="self" href="${feed}"/>` +
  releases.items.map((row, index) => `<entry><id>urn:synthetic:${row.itemId}</id><title>${row.itemTitle}</title>` +
    `<link href="${items[index].link}"/><published>${row.publication.rawValue}</published></entry>`).join("") + "</feed>";

function fixture(action: "BUY" | "CACHE" = "BUY", includeNew = true) {
  const catalog = vi.fn(async () => items);
  const lookup = vi.fn(async (_sourceId: string, url: string) => items.find(item => item.link === url && (includeNew || item !== newer)) ?? null);
  const decide = vi.fn(async (input: DecideInput) => input.candidates.map(c => ({ sourceId: c.id, sourceName: c.name,
    action, expectedValue: 0.9, price: c.fetchPrice, confidence: 0.9, targets: [0], rationale: "Synthetic creator selection" })));
  // Existing funded-capacity fixture only; payFetch always refuses before any settlement.
  const funding = vi.fn(async () => ({ address: `0x${"11".repeat(20)}` }));
  const buy = vi.fn(async (_input: Parameters<PaymentGateway["payFetch"]>[0]) => { throw new Error("Payment forbidden in this fixture"); });
  const forbidden = vi.fn(async () => { throw new Error("Unexpected external effect"); });
  const synthesize = vi.fn(async (input: SynthInput) => ({ answer: `[${input.gathered[0].marker}] Synthetic cached note.`,
    citedMarkers: [input.gathered[0].marker], evidence: [], conflicts: [] }));
  const effects: ResearchEffects = { scope: { kind: "public" }, discoverExternal: async () => [], decisionContext: async () => ({ sample: 0 }),
    getCached: async () => action === "CACHE" ? newer.content : null,
    getCachedAt: async () => action === "CACHE" ? new Date().toISOString() : null,
    setCached: forbidden, recordPayment: forbidden, saveQueryRun: async () => {}, saveMemory: async () => {},
    notifyCitation: () => {}, alert: () => {}, activation: async () => {} };
  const db = { listSources: async () => [source], listPublicReferences: async () => [], getItems: catalog,
    getSourceItemByLink: lookup, getItem: async (_sourceId: string, id: string) => items.find(item => item.id === id) ?? null,
    getArticleOffer: async () => null } as unknown as KeryxDB;
  const engine = { name: "inert-issue217-fixture", decompose: async () => subClaims, decide,
    sufficiency: async () => ({ sufficient: true, rationale: "Inert fixture", perClaim: [] }),
    synthesize, attribute: async () => [] } as unknown as ReasoningEngine;
  const gateway = { mode: "real", agentAddress: () => `0x${"11".repeat(20)}`, ensureFunded: funding,
    payFetch: buy, payCitation: forbidden } as unknown as PaymentGateway;
  const deps: AgentDeps = { db, engine, gateway, effects, readWebArticle: forbidden,
    webSearch: { search: async () => [] } as unknown as AgentDeps["webSearch"] };
  return { deps, catalog, lookup, decide, funding, buy, forbidden, synthesize };
}
async function drive(f: ReturnType<typeof fixture>, original = question) {
  const generator = runAgent({ queryId: "inert-issue217-fixture", question: original, origin: "web", budget: 0.1, researchMode: "quick" }, f.deps);
  let row = await generator.next(); while (!row.done) row = await generator.next();
  return row.value;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  transport.mockReset().mockResolvedValue({ bytes: new TextEncoder().encode(xml), finalUrl: feed, contentType: "application/atom+xml" });
});
afterEach(() => vi.useRealTimers());

it.each(["BUY", "CACHE"] as const)("qualifies the complete original registered-creator task before %s without settling", async action => {
  // The pre-recency relevance rule really would select the older stronger-overlap item.
  expect(selectRelevantSourceItem(question, subClaims, source.tags, items)).toBe(older);
  const f = fixture(action), run = await drive(f);
  expect(transport).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledWith(feed, expect.objectContaining({ requireFullResponse: true, maxHops: 0 }));
  expect(f.lookup).toHaveBeenCalledOnce();
  expect(f.lookup).toHaveBeenCalledWith(source.id, newer.link);
  expect(f.catalog).not.toHaveBeenCalled();
  expect(f.decide.mock.calls[0][0].candidates).toHaveLength(1);
  expect(f.decide.mock.calls[0][0].candidates[0]).toMatchObject({ sourceId: source.id, fetchPrice: 0.005,
    item: { itemId: newer.id, itemTitle: newer.title, itemUrl: newer.link, itemPublishedAt: newer.publishedAt } });
  if (action === "BUY") {
    expect(f.buy).toHaveBeenCalledOnce();
    expect(f.buy.mock.calls[0][0]).toMatchObject({ source, item: newer, priceUsdc: 0.005 });
    expect(f.synthesize).not.toHaveBeenCalled();
    expect(run.answer).toContain("No supported answer: source reads failed and no source payment was confirmed");
    expect(run.trace.some(event => event.message.includes("Payment forbidden in this fixture"))).toBe(true);
  } else {
    expect(f.buy).not.toHaveBeenCalled();
    expect(f.synthesize.mock.calls[0][0].gathered).toHaveLength(1);
    expect(f.synthesize.mock.calls[0][0].gathered[0]).toMatchObject({ sourceId: source.id, itemId: newer.id, itemUrl: newer.link });
  }
  expect(f.forbidden).not.toHaveBeenCalled();
  expect(run.sourceRecency).toMatchObject({ metadataReads: 1, gaps: [], observations: [{ sourceId: source.id, feedUrl: feed,
    capturedAt: "2026-10-08T12:00:00.000Z", rawBodySha256: createHash("sha256").update(xml).digest("hex"),
    membership: "complete-document", membershipCount: 10, filteredCount: 0, truncated: false,
    newestEntry: { title: newer.title, itemUrl: newer.link, publication: { field: "atom:published",
      rawValue: "2026-10-07T15:55:05Z", publishedAt: newer.publishedAt } } }] });
  expect(run.paymentMode).toBe("real"); expect(run.paymentAttempts).toBe(action === "BUY" ? 1 : 0);
  expect(run.settledPayments).toBe(0); expect(run.pendingPayments).toBe(0);
  expect(run.totalSpent).toBe(0); expect(run.totalToCreators).toBe(0);
  expect(run.evidence ?? []).toEqual([]); expect(run.sourceRecency?.observations[0].observationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
});

it("does not replace an observed unindexed v18 with the older registered creator article", async () => {
  const f = fixture("BUY", false), run = await drive(f);
  expect(transport).toHaveBeenCalledOnce(); expect(f.lookup).toHaveBeenCalledOnce();
  expect(f.catalog).not.toHaveBeenCalled(); expect(f.decide).not.toHaveBeenCalled();
  expect(f.buy).not.toHaveBeenCalled(); expect(f.funding).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  expect(run.sourceRecency?.gaps).toContainEqual(expect.objectContaining({ sourceId: source.id, reason: "newest-entry-not-indexed" }));
  expect(run.answer).toContain("No older article was substituted before BUY/CACHE");
  expect(run.totalSpent).toBe(0); expect(run.totalToCreators).toBe(0);
});

it.each([question.replace("newest release tag", "newest stable release tag"),
  question.replace("newest release tag", "newest prerelease tag"),
  question.replace("actually present", "before 2026-10-01 actually present"),
  question.replace("the feed and", "the retained feed and"),
  question.replace(feed, `${feed} and https://other.example/feed.atom`)])("holds unsupported full original-task variants without funding or BUY: %s", async original => {
  const f = fixture(), run = await drive(f, original);
  expect(transport).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled(); expect(f.catalog).not.toHaveBeenCalled();
  expect(f.decide).not.toHaveBeenCalled(); expect(f.buy).not.toHaveBeenCalled(); expect(f.funding).not.toHaveBeenCalled();
  expect(f.forbidden).not.toHaveBeenCalled(); expect(run.answer).toContain("Newest-release limitation");
  expect(run.sourceRecency).toMatchObject({ metadataReads: 0, observations: [] });
  expect(run.totalSpent).toBe(0); expect(run.totalToCreators).toBe(0);
});

it("retains ordinary nonrecency relevance and creator admission on the same source", async () => {
  const f = fixture(), run = await drive(f, "Explain release compatibility deployment change startup.");
  expect(transport).not.toHaveBeenCalled(); expect(f.lookup).not.toHaveBeenCalled(); expect(f.catalog).toHaveBeenCalledOnce();
  expect(f.decide.mock.calls[0][0].candidates[0].item?.itemId).toBe(older.id);
  expect(f.buy.mock.calls[0][0]).toMatchObject({ source, item: older, priceUsdc: 0.005 });
  expect(f.forbidden).not.toHaveBeenCalled(); expect(run.paymentAttempts).toBe(1); expect(run.settledPayments).toBe(0);
  expect(run.totalSpent).toBe(0); expect(run.totalToCreators).toBe(0); expect(run).not.toHaveProperty("sourceRecency");
});
