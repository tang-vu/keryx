import { referenceSnapshot, type PublicReference } from "../public-references/catalog";
import { createHash } from "node:crypto";
import { ResearchSelectionError } from "../llm/research-selection";
import { SQLITE_SELECTION_QUESTION, SQLITE_SELECTION_QUESTION_SHA256, SQLITE_SELECTION_TARGETS } from "../../test-support/sqlite-selection-fixture";
import { scholarlyCandidate } from "../scholarly/discovery";
import { SEED_SOURCES } from "../sources/seed-data";
import { contentBodyHash } from "../sources/content-receipt";
/**
 * Economic-invariant tests for the agent orchestrator (run-agent.ts).
 *
 * These lock the money-safety guarantees the product depends on — the things a hallucinated
 * model number must never be able to break, because the orchestrator (not the LLM) enforces them:
 *
 *   1. the hard fetch-budget cap is never exceeded (over-budget BUYs flip to SKIP);
 *   2. 100% of spend reaches creator wallets (payer = agent, payee = creator, no platform skim);
 *   3. a multi-author citation reward splits across authors and the legs sum back to the reward;
 *   4. the full citation pool is distributed when contribution weights sum to 1;
 *   5. external marketplace endpoints are always SKIP, regardless of advertised payment network;
 *   6. unverified sources are off the money path (listed, but never discovered/read/cited/paid);
 *   7. a single toll failure degrades gracefully — the run still answers from what it read;
 *   8. a missing budget falls back to the configured default.
 *   9. a confirmed debit stays settled when post-payment content/acknowledgement delivery fails.
 *
 * The engine, DB, and gateway are injected as fakes, so these exercise the orchestrator's
 * deterministic control flow only — no LLM, no network, no chain.
 */

import { describe, it, expect, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { runAgent, type RunInput } from "./run-agent";
import { collectRun } from "./index";
import type { ResearchEffects } from "./research-effects";
import { config } from "../config";
import { HeuristicEngine } from "../llm/heuristic-engine";
import { JsonChatEngine } from "../llm/json-chat-engine";
import { evidenceContext } from "../llm/evidence-context";
import { buildContextualQuoteOptions } from "../llm/quote-context";
import { prepareDecisionBrief, reviewDecisionBrief, briefEvidence } from "../llm/decision-brief";
import { makePayment, type PaymentGateway } from "../payments/payment-gateway";
import { PaymentPendingError, PaymentSettledError } from "../payments/payment-state";
import type { AgentDeps } from "./deps";
import type { KeryxDB } from "../db/keryx-db";
import type {
  DecideInput,
  ReevaluateInput,
  ReasoningEngine,
  SufficiencyResult,
  SynthResult,
  SufficiencyInput,
  SynthInput,
} from "../llm/reasoning-engine";
import type { ArticleOffer, Author, Decision, PaymentRecord, QueryRun, Source, SourceItem, TraceStep } from "../types";
import {
  sourceItemCacheKey,
  sourceItemContentVersion,
  sourceItemIdentity,
} from "../sources/source-item-asset";
import { articleOfferId, articleOfferTypedData } from "../offers/article-offer";
import { a2aResearchPackage, completedA2aServiceReceipt } from "../a2a/research-package";
import { a2aResponseFromRun } from "../a2a/result";
import { quoteA2aResearch } from "../a2a/pricing";
import { remoteResearchResult } from "../mcp/remote-server";
import { buildAnswerContent, keryxMeta } from "../openai-compat";
import { buildResearchReceipt, verifyResearchReceipt } from "../research-receipt";
import { researchReportMarkdown } from "../research-report-export";
import { exportsFromCheckedReceipt } from "../research/receipt-exports";
import { surfaceResearch } from "../research/surface-result";
import { ArticleReadError } from "../web-research/article-reader";
import * as fetchAuthority from "../registry/source-fetch-payto";
import type { SourceClaim } from "../sources/public-source-claim";
import { sourceClaimReceipt } from "../sources/source-claim-access";
import { fixtureEvidenceSpans } from "../../test-support/evidence-fixtures";
import { completeEvidenceSpans } from "../llm/evidence-span";

const AGENT = "0xAGENT";
const EPS = 1e-6;

// ── fixtures ──────────────────────────────────────────────────────────────

function makeSource(over: Partial<Source> & Pick<Source, "id">): Source {
  return {
    name: over.id,
    url: `https://${over.id}.example`,
    description: `desc ${over.id}`,
    walletAddress: `0xwallet-${over.id}`,
    fetchPrice: 0.002,
    tags: ["x402"],
    authors: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function buy(c: { id: string; name: string; price: number }, ev = 0.8): Decision {
  return {
    sourceId: c.id,
    sourceName: c.name,
    action: "BUY",
    expectedValue: ev,
    price: c.price,
    confidence: 0.9,
    rationale: `worth the $${c.price} toll`,
    targets: [0],
  };
}

// ── injectable fakes ────────────────────────────────────────────────────────

interface EngineOverrides {
  decide?: (input: DecideInput) => Decision[];
  sufficiency?: (input: SufficiencyInput) => SufficiencyResult;
  reevaluate?: (input: ReevaluateInput) => {
    claims?: {
      claim: string;
      coverage: number;
      coveredBy: string[];
      rationale: string;
    }[];
    shouldBuyMore: boolean;
    recommendedIds: string[];
    rationale: string;
  };
  synthesize?: (input: SynthInput) => Partial<SynthResult> &
    Pick<SynthResult, "answer" | "citedMarkers">;
  attribute?: (
    used: { sourceId: string }[],
  ) => { sourceId: string; weight: number; rationale: string }[];
}

/** A deterministic ReasoningEngine. Records the candidates the orchestrator passed to decide(). */
function fakeEngine(over: EngineOverrides = {}): ReasoningEngine & { decideInput?: DecideInput } {
  const self = {
    name: "test-fake",
    decideInput: undefined as DecideInput | undefined,
    async decompose() {
      return ["the sub-claim"];
    },
    async decide(input: DecideInput) {
      self.decideInput = input;
      // Default: BUY every internal candidate at its real price (tests override as needed).
      return (over.decide ?? ((i) => i.candidates.map((c) => buy({ id: c.id, name: c.name, price: c.fetchPrice }))))(input);
    },
    async sufficiency(input: SufficiencyInput) {
      const defaultClaims = input.subClaims.map((claim) => ({
        claim,
        coverage: 0.9,
        coveredBy: input.gathered.map((g) => g.marker),
      }));
      const r = (
        over.sufficiency ??
        (() => ({
          sufficient: true,
          rationale: "enough read",
          perClaim: defaultClaims,
        }))
      )(input);
      return { ...r, perClaim: r.perClaim ?? defaultClaims };
    },
    async reevaluate(input: ReevaluateInput) {
      const r = (over.reevaluate ?? (() => ({ shouldBuyMore: false, recommendedIds: [], rationale: "no gaps" })))(input);
      return { claims: [], ...r };
    },
    async synthesize(input: SynthInput) {
      if (over.synthesize) {
        const r = over.synthesize(input);
        return {
          ...r,
          conflicts: r.conflicts ?? [],
          evidence: fixtureEvidenceSpans(input.gathered, r.evidence ?? []),
        };
      }
      return {
        answer: `grounded answer ${input.gathered.map((g) => `[${g.marker}]`).join(" ")}`,
        citedMarkers: input.gathered.map((g) => g.marker),
        conflicts: [],
        evidence: input.gathered.flatMap((g) => completeEvidenceSpans(g).slice(0, 1).map(span => ({
          claimIndex: 0,
          marker: g.marker,
          quote: g.text.slice(span.start, span.end),
          quoteSpan: span,
          support: 0.9,
        }))),
      };
    },
    async attribute(input: { used: { sourceId: string }[] }) {
      return (over.attribute ?? ((used) => used.map((u) => ({ sourceId: u.sourceId, weight: 1 / used.length, rationale: "equal" }))))(input.used);
    },
  };
  return self as unknown as ReasoningEngine & { decideInput?: DecideInput };
}

interface FakeGateway extends PaymentGateway {
  fetchCalls: string[];
  fetchItems: (string | undefined)[];
  fetchPrices: number[];
  fetchOffers: (string | undefined)[];
  citationCalls: { sourceId: string; payee: string; amount: number }[];
}

/** A gateway that always settles. `failOn` makes payFetch throw for a given source id. */
function fakeGateway(opts: { failOn?: string } = {}): FakeGateway {
  const gw: FakeGateway = {
    mode: "real",
    fetchCalls: [],
    fetchItems: [],
    fetchPrices: [],
    fetchOffers: [],
    citationCalls: [],
    agentAddress: () => AGENT,
    async ensureFunded() {
      return { address: AGENT };
    },
    async payFetch({ source, item, queryId, priceUsdc = source.fetchPrice, offer }) {
      if (opts.failOn === source.id) throw new Error("settlement failed");
      gw.fetchCalls.push(source.id);
      gw.fetchItems.push(item?.id);
      gw.fetchPrices.push(priceUsdc);
      gw.fetchOffers.push(offer?.id);
      const payment = makePayment({
        kind: "fetch",
        queryId,
        sourceId: source.id,
        sourceName: source.name,
        ...(item ? sourceItemIdentity(item) : {}),
        payer: AGENT,
        payee: source.walletAddress,
        amountUsdc: priceUsdc,
        offerId: offer?.id,
        listPriceUsdc: offer?.listPriceUsdc,
        settled: true,
        txHash: "0xfetch",
      });
      return { content: item?.content || `content:${source.id}.`, payment };
    },
    async payCitation({ source, author, item, amount, weight, queryId, rationale }) {
      gw.citationCalls.push({ sourceId: source.id, payee: author.walletAddress, amount });
      return makePayment({
        kind: "citation",
        queryId,
        sourceId: source.id,
        sourceName: source.name,
        ...item,
        payer: AGENT,
        payee: author.walletAddress,
        amountUsdc: amount,
        weight,
        rationale,
        settled: true,
        txHash: "0xcite",
      });
    },
  };
  return gw;
}

/** What a source's cache and feed look like to the orchestrator, per source id. */
interface DbState {
  /** ISO timestamp the cached copy was taken; absent = nothing cached. */
  cachedAt?: Record<string, string>;
  /** ISO publication date of the source's newest post. */
  newestItem?: Record<string, string>;
  /** Explicit article rows, newest first. */
  items?: Record<string, SourceItem[]>;
  /** Cache timestamps keyed by exact opaque cache key. */
  cachedByKey?: Record<string, string>;
  /** Current signed offer keyed by `${sourceId}:${itemId}`. */
  offers?: Record<string, ArticleOffer>;
}

/** A KeryxDB that serves the given sources and records payments. Only the methods the
 *  orchestrator (and its best-effort memory/notify helpers) touch are implemented. */
function fakeDb(sources: Source[], state: DbState = {}): KeryxDB & { payments: PaymentRecord[] } {
  const payments: PaymentRecord[] = [];
  const db = {
    payments,
    async listSources() {
      return sources;
    },
    async getSource(id: string) { return sources.find(source => source.id === id) ?? null; },
    async getItem(sourceId: string, itemId: string) { return state.items?.[sourceId]?.find(item => item.id === itemId) ?? null; },
    async getItems(sourceId: string) {
      if (state.items?.[sourceId]) return state.items[sourceId];
      const publishedAt = state.newestItem?.[sourceId];
      if (!publishedAt) return [];
      return [
        {
          id: `${sourceId}-i1`,
          sourceId,
          title: "post",
          summary: "summary",
          content: "content",
          link: "https://example.test/post",
          publishedAt,
        },
      ];
    },
    async getArticleOffer(sourceId: string, itemId: string) {
      return state.offers?.[`${sourceId}:${itemId}`] ?? null;
    },
    async getCached(sourceId: string) {
      return state.cachedAt?.[sourceId] || state.cachedByKey?.[sourceId]
        ? `cached:${sourceId}.`
        : null;
    },
    async getCachedAt(sourceId: string) {
      return state.cachedAt?.[sourceId] ?? state.cachedByKey?.[sourceId] ?? null;
    },
    async setCached() {},
    async recordPayment(p: PaymentRecord) {
      payments.push(p);
    },
    async loadQueryMemories() {
      return [];
    },
    async saveQueryMemory() {},
    async recordActivationEvent() {},
    async getSourceNotify() {
      return null;
    },
  };
  return db as unknown as KeryxDB & { payments: PaymentRecord[] };
}

function deps(
  sources: Source[],
  engine: ReasoningEngine,
  gateway: PaymentGateway,
  state: DbState = {},
): AgentDeps & {
  db: KeryxDB & { payments: PaymentRecord[] };
} {
  const db = fakeDb(sources, state);
  return { engine, gateway, db };
}

/** Drive the orchestrator generator to completion, collecting the trace and the final run. */
async function drive(
  input: RunInput,
  d: AgentDeps,
): Promise<{ run: QueryRun; steps: TraceStep[] }> {
  const gen = runAgent(input, d);
  const steps: TraceStep[] = [];
  let res = await gen.next();
  while (!res.done) {
    steps.push(res.value);
    res = await gen.next();
  }
  return { run: res.value, steps };
}

const fetchBudget = (budget: number) => budget * (1 - config.citationPoolRatio);
const citationPool = (budget: number) => budget * config.citationPoolRatio;

const paper = (arxivId = "1706.03762v7") => scholarlyCandidate({ provider: "arxiv", recordUrl: "https://export.arxiv.org/api/query?id_list=" + arxivId,
  retrievedAt: "2026-10-01T00:00:00Z", title: "Observed paper " + arxivId, authors: ["Observed Author"], arxivId, workType: "preprint", peerReview: "unknown" });
function injectPapers(d: AgentDeps, ids = ["1706.03762v7"]) {
  const candidates = new Map(ids.map(id => { const candidate = paper(id); return [candidate.id, candidate]; }));
  d.discoverScholarly = vi.fn(async () => ({ candidates, succeeded: 1, unavailable: 0, requestedDois: 0, resolvedDois: 0 }));
}
it("reads exact versioned scholarly PDFs, preserves observed metadata, and never funds or pays paper authors", async () => {
  const d = deps([], fakeEngine(), fakeGateway()); injectPapers(d);
  const funded = vi.spyOn(d.gateway, "ensureFunded");
  d.readWebArticle = vi.fn(async (url: string) => ({ text: "The versioned paper actually contains this evidence. Unfinished extraction tail", title: "pdf hostname", finalUrl: url, kind: "pdf" as const, truncated: true }));
  const { run } = await drive({ question: "Transformer attention", scholarly: true, origin: "web" }, d);
  expect(d.discoverScholarly).toHaveBeenCalledWith("Transformer attention", true, expect.any(AbortSignal));
  expect(run.citations[0]).toMatchObject({ sourceKind: "public-reference", reward: 0, itemUrl: "https://arxiv.org/pdf/1706.03762v7",
    scholarly: { arxivId: "1706.03762v7", evidenceScope: "paper-text", workType: "preprint", peerReview: "unknown" }, webProvenance: { truncated: true } });
  expect(run.evidence?.[0]).toMatchObject({ qualifiesForReward: false, scholarly: { evidenceScope: "paper-text" } });
  expect(funded).not.toHaveBeenCalled(); expect((d.gateway as FakeGateway).fetchCalls).toEqual([]); expect((d.gateway as FakeGateway).citationCalls).toEqual([]); expect(run.totalSpent).toBe(0);
});
it("counts PDF and explicit abstract fallback as separate read attempts under the aggregate quick cap", async () => {
  const d = deps([], fakeEngine({ decide: input => input.candidates.map((candidate, index) => ({ ...buy({ id: candidate.id, name: candidate.name, price: 0 }), targets: [index] })) }), fakeGateway());
  d.engine.decompose = async () => ["first claim", "second claim", "third claim"];
  injectPapers(d, ["1706.03762v7", "1706.03763v1", "1706.03764v1"]);
  d.readWebArticle = vi.fn(async (url: string) => { if (url.includes("/pdf/")) throw new Error("full paper unavailable");
    return { text: `Abstract evidence at ${url}.`, title: "Abstract", finalUrl: url, kind: "html" as const, truncated: false }; });
  const { run, steps } = await drive({ question: "Transformer attention", scholarly: true, origin: "web", researchMode: "quick", executionLimits: { attentionLimit: 3, reevaluateRounds: 0 } }, d);
  expect(d.readWebArticle).toHaveBeenCalledTimes(4); expect(run.citations).toHaveLength(2);
  for (const citation of run.citations) expect(citation).toMatchObject({ publicDeliveryKind: "abstract", scholarly: { evidenceScope: "abstract-page" } });
  expect(steps.filter(step => step.message.includes("only the abstract page was read"))).toHaveLength(2);
  expect(steps.some(step => step.message.includes("web-operation-limit"))).toBe(true);
});
it("refuses changed arXiv versions or non-PDF paper responses instead of attaching old bibliographic provenance", async () => {
  for (const wrong of [{ finalUrl: "https://arxiv.org/pdf/1706.03762v8", kind: "pdf" as const }, { finalUrl: "https://arxiv.org/pdf/1706.03762v7", kind: "html" as const }]) {
    const d = deps([], fakeEngine(), fakeGateway()); injectPapers(d);
    d.readWebArticle = vi.fn(async () => ({ text: "This is another document.", title: "Wrong version", truncated: false, ...wrong }));
    const { run } = await drive({ question: "Attention", scholarly: true, origin: "web" }, d);
    expect(run.citations).toEqual([]); expect(run.evidence ?? []).toEqual([]);
  }
});
it("does not admit scholarly discovery metadata when original content cannot be read", async () => {
  const d = deps([], fakeEngine(), fakeGateway()); injectPapers(d);
  d.readWebArticle = vi.fn(async () => { throw new Error("paywall internal"); });
  const { run, steps } = await drive({ question: "Attention", scholarly: true, origin: "web" }, d);
  expect(run.citations).toEqual([]); expect(JSON.stringify(steps)).not.toContain("paywall internal");
});
it("treats HTML at the unchanged PDF URL as unavailable PDF and explicitly reads the abstract fallback", async () => {
  const d = deps([], fakeEngine(), fakeGateway()); injectPapers(d);
  d.readWebArticle = vi.fn(async (url: string) => ({ text: url.includes("/pdf/") ? "Publisher challenge" : "Original abstract evidence.", title: "Page", finalUrl: url, kind: "html" as const, truncated: false }));
  const { run, steps } = await drive({ question: "Attention", scholarly: true, origin: "web" }, d);
  expect(d.readWebArticle).toHaveBeenCalledTimes(2);
  expect(run.citations[0]).toMatchObject({ itemUrl: "https://arxiv.org/abs/1706.03762v7", scholarly: { evidenceScope: "abstract-page" } });
  expect(steps.some(step => step.message.includes("paper PDF unavailable (pdf-extraction-unavailable)"))).toBe(true);
  expect(run.evidence?.[0].quote).not.toContain("Publisher challenge");
});
it("withholds scholarly opt-in, DOI and explicit arXiv queries from private jobs and unattended engine runs", async () => {
  const d = deps([], fakeEngine(), fakeGateway()); injectPapers(d);
  await drive({ question: "10.1234/exact arXiv 2607.13716v1", scholarly: true }, d); expect(d.discoverScholarly).not.toHaveBeenCalled();
  const queryId = `prv_${"7".repeat(64)}`; d.effects = isolatedTestEffects(queryId);
  await drive({ question: "10.1234/exact arXiv 2607.13716v1", scholarly: true, queryId, allowExternalWeb: true }, d); expect(d.discoverScholarly).not.toHaveBeenCalled();
});
it("automatically resolves a question DOI without opting into general scholarly search", async () => {
  const d = deps([], fakeEngine(), fakeGateway()); injectPapers(d);
  d.readWebArticle = async url => ({ text: "Observed original paper evidence.", title: "Paper", finalUrl: url, kind: "pdf", truncated: false });
  await drive({ question: "Explain 10.1234/exact", origin: "web" }, d);
  expect(d.discoverScholarly).toHaveBeenCalledWith("Explain 10.1234/exact", false, expect.any(AbortSignal));
});

it.each([
  "Use https://www.sqlite.org/wal.html and https://www.sqlite.org/pragma.html#pragma_synchronous to explain WAL durability.",
  "Use https://www.postgresql.org/docs/current/sql-select.html to explain queue locking and crash gaps.",
])("considers supplied originals omitted by discovery and binds their bounded scope to trace and receipt: %s", async question => {
  const d = deps([], fakeEngine(), fakeGateway());
  const fund = vi.spyOn(d.gateway, "ensureFunded");
  d.webSearch = { search: async () => [] };
  d.readWebArticle = vi.fn(async url => ({ text: "Synthetic original document evidence used only for this fixture.", title: "Original", finalUrl: url, kind: "html" as const, truncated: true }));
  const { run, steps } = await drive({ question, origin: "web" }, d);
  const candidates = (d.engine as ReturnType<typeof fakeEngine>).decideInput?.candidates ?? [];
  const expected = question.includes("sqlite") ? 2 : 1;
  expect(candidates).toHaveLength(expected);
  expect(d.readWebArticle).toHaveBeenCalledTimes(expected);
  expect(run.decisions).toHaveLength(expected);
  expect(run.decisions.every(item => item.requestedSource?.readScope === "bounded-whole-document")).toBe(true);
  expect(steps.some(step => step.message.includes("Supplied source URL"))).toBe(true);
  expect(run.answer).toContain("Supplied original source status");
  expect(run.answer).toContain("Extraction was truncated");
  if (question.includes("#")) expect(run.answer).toContain("not that section specifically");
  const receipt = buildResearchReceipt(run, []);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.agency.decisions.map(item => item.requestedSource)).toEqual(run.decisions.map(item => item.requestedSource));
  expect(receipt.payload.dispatch.answer).toBe(run.answer);
  for (const result of [remoteResearchResult(run), a2aResponseFromRun(run, quoteA2aResearch(0.03, "quick"))]) expect(result.answer).toBe(run.answer);
  expect(fund).not.toHaveBeenCalled();
  expect((d.gateway as FakeGateway).fetchCalls).toEqual([]);
  expect((d.gateway as FakeGateway).citationCalls).toEqual([]);
});

it("makes omitted supplied originals inspectable when only secondary evidence is selected", async () => {
  const d = deps([], fakeEngine({ decide: input => input.candidates.filter(c => !c.item?.requestedSource).map(c => buy({ id: c.id, name: c.name, price: 0 })) }), fakeGateway());
  d.webSearch = { search: async () => [{ title: "Secondary", url: "https://secondary.example/queue", snippet: "preview" }] };
  d.readWebArticle = async url => ({ text: "Synthetic secondary evidence is not a read of the supplied original.", title: "Secondary", finalUrl: url, kind: "html", truncated: false });
  const { run } = await drive({ question: "Use https://www.postgresql.org/docs/current/sql-select.html to explain queues.", origin: "web" }, d);
  expect(run.decisions.find(item => item.requestedSource)?.action).toBe("SKIP");
  expect(run.answer).toContain("reasoning engine omitted this supplied original");
  expect(run.citations[0]?.itemUrl).toBe("https://secondary.example/queue");
  expect(run.citations.some(item => item.requestedSource)).toBe(false);
});

it("merges a search preview for the same original without losing requested fragment scope or duplicating the read", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  d.webSearch = { search: async () => [{ title: "Search title", url: "https://www.sqlite.org/pragma.html", snippet: "An unverified search preview." }] };
  d.readWebArticle = vi.fn(async url => ({ text: "Synthetic original text, not the search preview.", title: "Original", finalUrl: url, kind: "html" as const, truncated: false }));
  const { run } = await drive({ question: "Use https://www.sqlite.org/pragma.html#pragma_synchronous", origin: "web" }, d);
  expect(d.readWebArticle).toHaveBeenCalledTimes(1);
  expect(run.decisions).toHaveLength(1);
  expect(run.citations[0]?.requestedSource?.urls).toEqual(["https://www.sqlite.org/pragma.html#pragma_synchronous"]);
  expect(run.evidence?.[0]?.requestedSource).toEqual(run.citations[0]?.requestedSource);
  expect(buildResearchReceipt(run, []).payload.citations[0]?.requestedSource).toEqual(run.citations[0]?.requestedSource);
  expect(researchReportMarkdown(run, null, [])).toContain("Supplied original scope");
  for (const result of [remoteResearchResult(run), a2aResponseFromRun(run, quoteA2aResearch(0.03, "quick")), keryxMeta(run), surfaceResearch(run)]) {
    expect(JSON.stringify(result)).toContain("bounded-whole-document");
  }
});

it("reports supplied originals' read failures and existing URLs in empty recovery without leaking transport details", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  d.webSearch = { search: async () => [] };
  d.readWebArticle = async () => { throw new ArticleReadError("html-extraction-unavailable"); };
  const { run } = await drive({ question: "Use https://www.sqlite.org/wal.html for WAL durability.", origin: "web" }, d);
  expect(run.answer).toContain("Source URLs were already supplied in the question");
  expect(run.answer).toContain("Read failed: html-extraction-unavailable");
  expect(run.answer).not.toContain("supply a relevant original source URL");
});

it("binds an extraction failure to the original asset after search changes its display title", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  d.webSearch = { search: async () => [{ title: "A renamed preview", url: "https://www.sqlite.org/wal.html", snippet: "preview" }] };
  d.readWebArticle = async () => { throw new ArticleReadError("html-extraction-unavailable"); };
  const { run } = await drive({ question: "Use https://www.sqlite.org/wal.html", origin: "web" }, d);
  expect(run.answer).toContain("`https://www.sqlite.org/wal.html`: Read failed: html-extraction-unavailable");
});

it("merges an exact supplied arXiv PDF with scholarly metadata into one original read identity", async () => {
  const candidate = scholarlyCandidate({ provider: "arxiv", recordUrl: "https://export.arxiv.org/api/query?id_list=2606.02668v1",
    retrievedAt: new Date().toISOString(), title: "Exact paper", authors: [], arxivId: "2606.02668v1", workType: "preprint", peerReview: "unknown" });
  const d = deps([], fakeEngine(), fakeGateway());
  d.webSearch = { search: async () => [{ title: "Search preview of the same paper", url: "https://arxiv.org/pdf/2606.02668v1", snippet: "unverified" }] };
  d.discoverScholarly = async () => ({ candidates: new Map([[candidate.id, candidate]]), succeeded: 1, unavailable: 0, requestedDois: 0, resolvedDois: 0 });
  d.readWebArticle = vi.fn(async url => ({ text: "The exact original paper was read under this synthetic transport.", title: "Paper", finalUrl: url, kind: "pdf" as const, truncated: false }));
  const { run } = await drive({ question: "Use https://arxiv.org/pdf/2606.02668v1", origin: "web" }, d);
  expect(d.readWebArticle).toHaveBeenCalledTimes(1);
  expect(run.decisions).toHaveLength(1);
  expect(run.decisions[0].requestedSource?.urls).toEqual(["https://arxiv.org/pdf/2606.02668v1"]);
  expect(run.citations[0]?.scholarly?.evidenceScope).toBe("paper-text");
  expect(run.answer).toContain("Bounded text extracted from `https://arxiv.org/pdf/2606.02668v1`");
  expect(run.answer).not.toContain("omitted this supplied original");
});

it("withholds explicit URL transport for unattended research and rejects changed exact arXiv versions", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  d.readWebArticle = vi.fn(async () => ({ text: "A different version.", title: "Wrong", finalUrl: "https://arxiv.org/pdf/2606.02668v2", kind: "pdf" as const, truncated: false }));
  const withheld = await drive({ question: "Use https://example.com/private-task", origin: "engine" }, d);
  expect(d.readWebArticle).not.toHaveBeenCalled();
  expect(withheld.run.answer).toContain("external document access is withheld");
  d.webSearch = { search: async () => [] };
  d.discoverScholarly = async () => ({ candidates: new Map(), succeeded: 0, unavailable: 1, requestedDois: 0, resolvedDois: 0 });
  const { run } = await drive({ question: "Use https://arxiv.org/pdf/2606.02668v1", origin: "web" }, d);
  expect(run.citations).toEqual([]);
  expect(run.answer).toContain("document-identity-changed");
});

it("reads selected original web content without funding, rejects snippet evidence and preserves fetched provenance", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  const fund = vi.spyOn(d.gateway, "ensureFunded");
  d.webSearch = { search: vi.fn(async () => [{ title: "Original page", url: "https://publisher.example/article", snippet: "search-only claim never read" }]) };
  d.readWebArticle = vi.fn(async () => ({ text: "Exact original evidence from the public page.", title: "Original article", finalUrl: "https://publisher.example/final", kind: "html" as const, truncated: false }));
  const { run, steps } = await drive({ question: "Research the original", budget: 0.05, origin: "web" }, d);
  expect(fund).not.toHaveBeenCalled(); expect((d.gateway as FakeGateway).fetchCalls).toHaveLength(0); expect((d.gateway as FakeGateway).citationCalls).toHaveLength(0); expect(run.totalSpent).toBe(0);
  expect(run.citations).toHaveLength(1); expect(run.citations[0]).toMatchObject({ itemUrl: "https://publisher.example/final", reward: 0, webProvenance: { extraction: "html" } });
  expect(run.evidence?.[0]).toMatchObject({ quote: "Exact original evidence from the public page.", qualifiesForReward: false, webProvenance: { extraction: "html" } });
  expect(steps.some(step => step.message.includes("not a cache hit"))).toBe(true);
});

it.each([
  ["SQLite", ["https://www.sqlite.org/wal.html", "https://www.sqlite.org/pragma.html#pragma_synchronous"]],
  ["PostgreSQL", ["https://www.postgresql.org/docs/current/sql-select.html"]],
] as const)("offers and reads caller-supplied %s originals when controlled search omits them", async (_product, suppliedUrls) => {
  const urls: readonly string[] = suppliedUrls;
  const engine = fakeEngine({ sufficiency: () => ({ sufficient: false, rationale: "Controlled fixture needs each target" }),
    decide: input => input.candidates.map((candidate, index) => ({ ...buy({ id: candidate.id, name: candidate.name, price: 0 }), targets: [index] })) });
  engine.decompose = async () => urls.map((_, index) => `What does requested document ${index + 1} state?`);
  const d = deps([], engine, fakeGateway()), fund = vi.spyOn(d.gateway, "ensureFunded");
  d.webSearch = { search: vi.fn(async () => []) };
  d.readWebArticle = vi.fn(async url => {
    const finalUrl = new URL(url); finalUrl.hash = "";
    return { text: `Controlled document ${urls.indexOf(url) + 1} contains an intact synthetic evidence sentence. Unfinished extraction tail`,
      title: "Controlled original", finalUrl: finalUrl.href, kind: "html" as const, truncated: true };
  });
  const { run, steps } = await drive({ question: `Use ${urls.join(" and ")} to inspect the originals.`, origin: "web",
    researchMode: "deep", executionLimits: { attentionLimit: urls.length, reevaluateRounds: 0 } }, d);
  expect(d.readWebArticle).toHaveBeenCalledTimes(urls.length);
  for (const url of urls) {
    const bodyUrl = new URL(url); bodyUrl.hash = "";
    expect(d.readWebArticle).toHaveBeenCalledWith(bodyUrl.href, expect.any(AbortSignal));
    expect(engine.decideInput?.candidates.some(candidate => candidate.item?.itemUrl === bodyUrl.href && candidate.item.requestedSource?.urls.includes(url))).toBe(true);
    expect(steps.some(step => step.message.includes(`Supplied source URL ${url} admitted`))).toBe(true);
  }
  expect(run.citations).toHaveLength(urls.length);
  expect(run.citations.every(citation => citation.reward === 0 && citation.webProvenance?.truncated === true)).toBe(true);
  expect(steps.some(step => step.message.includes("bounded whole-document read"))).toBe(true);
  expect(fund).not.toHaveBeenCalled(); expect(d.db.payments).toEqual([]);
  const receipt = buildResearchReceipt(run, d.db.payments);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.dispatch.question).toBe(run.question);
  expect(receipt.payload.dispatch.answer).toBe(run.answer);
});

it.each(["missing", "invalid"])("offers exact supplied URLs with %s provider configuration without promoting an omitted decision", async state => {
  const configured = config.webSearchProvider, endpoint = config.webSearchUrl;
  Object.assign(config, { webSearchProvider: state === "missing" ? "" : "searxng", webSearchUrl: "invalid" });
  try {
    const engine = fakeEngine({ decide: () => [] }), d = deps([], engine, fakeGateway());
    d.readWebArticle = vi.fn(async () => { throw new Error("Unexpected read"); });
    const { run, steps } = await drive({ question: "Use https://www.sqlite.org/wal.html for this decision.", origin: "web" }, d);
    expect(engine.decideInput?.candidates.some(candidate => candidate.item?.itemUrl === "https://www.sqlite.org/wal.html")).toBe(true);
    expect(run.decisions.find(decision => decision.itemUrl === "https://www.sqlite.org/wal.html")).toMatchObject({ action: "SKIP", price: 0,
      rationale: expect.stringContaining("No valid decision was returned") });
    expect(d.readWebArticle).not.toHaveBeenCalled();
    expect(run.answer).toContain("Source URLs were already supplied");
    expect(run.answer).not.toContain("supply a relevant original source URL");
    expect(steps.some(step => step.message.includes(state === "missing"
      ? "search provider not configured, supplied URL leads only" : "search configuration unavailable, supplied URL leads only"))).toBe(true);
  } finally { Object.assign(config, { webSearchProvider: configured, webSearchUrl: endpoint }); }
});

it("records unsafe source refusals without inventing a read attempt", async () => {
  const configured = config.webSearchProvider; Object.assign(config, { webSearchProvider: "" });
  try {
    const d = deps([], fakeEngine(), fakeGateway());
    d.readWebArticle = vi.fn(async () => { throw new Error("Unsafe read"); });
    const { run, steps } = await drive({ question: "Read https://127.0.0.1/private and http://docs.example/legacy.", origin: "web" }, d);
    expect(d.readWebArticle).not.toHaveBeenCalled(); expect(run.citations).toEqual([]);
    expect(steps.some(step => step.message.includes("non-public-literal-host"))).toBe(true);
    expect(steps.some(step => step.message.includes("https-required"))).toBe(true);
    expect(run.answer).toContain("discovery refusal");
    expect(run.answer).not.toContain("Selected public originals could not supply usable text");
  } finally { Object.assign(config, { webSearchProvider: configured }); }
});

it.each(["unattended", "private", "private-opt-in"])("withholds supplied URL reads for %s research", async scope => {
  const d = deps([], fakeEngine(), fakeGateway());
  const search = vi.fn(async () => []); d.webSearch = { search };
  d.readWebArticle = vi.fn(async () => { throw new Error("Forbidden read"); });
  const privateId = `prv_${"6".repeat(64)}`;
  if (scope !== "unattended") d.effects = isolatedTestEffects(privateId);
  const { run, steps } = await drive({ question: "Use https://docs.example/original.", origin: scope === "unattended" ? "engine" : "web",
    ...(scope !== "unattended" ? { queryId: privateId } : {}), ...(scope === "private-opt-in" ? { allowExternalWeb: true } : {}) }, d);
  expect(search).not.toHaveBeenCalled(); expect(d.readWebArticle).not.toHaveBeenCalled();
  expect(run.decisions.some(decision => decision.itemUrl === "https://docs.example/original")).toBe(false);
  expect(steps.some(step => step.message.includes("Supplied source URL"))).toBe(false);
});
it("never promotes an unread search snippet into evidence and contains page-read failures", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  d.webSearch = { search: async () => [{ title: "snippet", url: "https://publisher.example/article", snippet: "invented evidence" }] };
  d.readWebArticle = vi.fn(async () => { throw new Error("internal secret response"); });
  const { run, steps } = await drive({ question: "Unanswerable original question", origin: "web" }, d);
  expect(run.citations).toHaveLength(0); expect(run.evidence ?? []).toHaveLength(0); expect((d.gateway as FakeGateway).fetchCalls).toHaveLength(0); expect((d.gateway as FakeGateway).citationCalls).toHaveLength(0);
  expect(JSON.stringify(steps)).not.toContain("internal secret response");
});

it("preserves the Quick read slot for a document when search returns forum threads first", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  const fund = vi.spyOn(d.gateway, "ensureFunded");
  d.webSearch = { search: async () => [
    { title: "Forum proposal", url: "https://sqlite.org/forum/info/first", snippet: "A proposal" },
    { title: "Another proposal", url: "https://sqlite.org/forum/info/second", snippet: "Another proposal" },
    { title: "Backup documentation", url: "https://sqlite.org/backup.html", snippet: "Documentation preview" },
  ] };
  d.readWebArticle = vi.fn(async url => ({ text: "The documentation describes consistent database snapshots.",
    title: "Document", finalUrl: url, kind: "html" as const, truncated: false }));
  const { run, steps } = await drive({ question: "Use official SQLite documentation to explain backups.", origin: "web",
    researchMode: "quick", executionLimits: { attentionLimit: 1, reevaluateRounds: 0 } }, d);
  expect(d.readWebArticle).toHaveBeenCalledTimes(1);
  expect(run.citations[0]?.itemUrl).toBe("https://sqlite.org/backup.html");
  expect(steps.some(step => step.message.includes("discussion"))).toBe(true);
  expect(fund).not.toHaveBeenCalled();
  expect((d.gateway as FakeGateway).fetchCalls).toEqual([]);
});

it.each([false, true])("skips a known owned discussion before funding or reading, including cached=%s and reevaluation", async cached => {
  const source = makeSource({ id: "discussion", fetchPrice: 0.002 });
  const item: SourceItem = { id: "thread", sourceId: source.id, title: "Forum", summary: "A suggestion",
    link: "https://sqlite.org/forum/info/example", content: "The participant proposes a backup procedure." };
  const engine = fakeEngine({ sufficiency: () => ({ sufficient: false, rationale: "Need documentation" }),
    reevaluate: () => ({ shouldBuyMore: true, recommendedIds: [source.id], rationale: "Model tries blocked source" }) });
  const gateway = fakeGateway();
  const d = deps([source], engine, gateway, { items: { [source.id]: [item] },
    ...(cached ? { cachedByKey: { [sourceItemCacheKey(source.id, item)]: "2026-10-05" } } : {}) });
  const fund = vi.spyOn(gateway, "ensureFunded");
  const { run } = await drive({ question: "Use official SQLite documentation to explain backups.", budget: 0.05,
    researchMode: "deep", executionLimits: { attentionLimit: 2, reevaluateRounds: 1 } }, d);
  expect(run.decisions[0]?.action).toBe("SKIP");
  expect(run.citations).toEqual([]); expect(run.totalSpent).toBe(0);
  expect(fund).not.toHaveBeenCalled(); expect(gateway.fetchCalls).toEqual([]); expect(gateway.citationCalls).toEqual([]);
});

it("retains ordinary discussion requests but withholds citations after a document redirects to a forum", async () => {
  for (const official of [false, true]) {
    const d = deps([], fakeEngine(), fakeGateway());
    d.webSearch = { search: async () => [{ title: "Backup", url: "https://sqlite.org/backup.html", snippet: "Backup preview" }] };
    d.readWebArticle = vi.fn(async () => ({ text: "The participant proposes a backup procedure.", title: "Forum proposal",
      finalUrl: "https://sqlite.org/forum/info/example", kind: "html" as const, truncated: false }));
    const { run } = await drive({ question: official ? "Use official SQLite documentation to explain backups." : "What backup procedure does the discussion propose?", origin: "web" }, d);
    expect(d.readWebArticle).toHaveBeenCalledTimes(1);
    expect(run.citations).toHaveLength(official ? 0 : 1);
    expect((d.gateway as FakeGateway).citationCalls).toEqual([]);
  }
});

it("retains a forum comparison target while removing its incompatible documentation target", async () => {
  const question = "Use official SQLite documentation for the guarantee. Then summarize user forum experiences.";
  const claims = ["Use official SQLite documentation for the guarantee.", "Summarize user forum experiences."];
  const engine = fakeEngine({ decide: input => input.candidates.map(candidate => ({ ...buy({ id: candidate.id, name: candidate.name, price: 0 }), targets: [0, 1] })),
    synthesize: input => ({ answer: "Forum proposal [S1].", citedMarkers: ["S1"],
      evidence: claims.map((_, claimIndex) => ({ claimIndex, marker: "S1", quote: input.gathered[0].text, support: 1 })) }) });
  engine.decompose = async () => claims;
  const d = deps([], engine, fakeGateway());
  d.webSearch = { search: async () => [{ title: "Forum", url: "https://sqlite.org/forum/info/proposal", snippet: "A proposal" }] };
  d.readWebArticle = vi.fn(async url => ({ text: "The participant proposes a backup procedure.", title: "Forum",
    finalUrl: url, kind: "html" as const, truncated: false }));
  const { run } = await drive({ question, origin: "web", researchMode: "quick" }, d);
  expect(d.readWebArticle).toHaveBeenCalledTimes(1);
  expect(run.decisions[0].targets).toEqual([1]);
  expect(run.evidence?.map(row => row.claimIndex)).toEqual([1]);
  expect(run.claimCoverage?.[0].coveredBy).toEqual([]);
  expect(run.citations).toHaveLength(1);
  expect(run.totalSpent).toBe(0);
});

it("does not buy a discussion proposed only for an explicit documentation target", async () => {
  const source = makeSource({ id: "forum-only" });
  const item: SourceItem = { id: "thread", sourceId: source.id, title: "Forum", summary: "A proposal",
    link: "https://sqlite.org/forum/info/proposal", content: "The participant proposes a backup procedure." };
  const engine = fakeEngine({ sufficiency: () => ({ sufficient: false, rationale: "Needs docs" }),
    reevaluate: () => ({ shouldBuyMore: true, recommendedIds: [source.id], rationale: "Try forum" }) });
  engine.decompose = async () => ["Use official SQLite documentation to explain backups."];
  const gateway = fakeGateway(), fund = vi.spyOn(gateway, "ensureFunded");
  const { run } = await drive({ question: "Explain database backups.", researchMode: "deep", budget: 0.05 },
    deps([source], engine, gateway, { items: { [source.id]: [item] } }));
  expect(run.decisions[0].action).toBe("SKIP");
  expect(fund).not.toHaveBeenCalled(); expect(gateway.fetchCalls).toEqual([]);
  expect(run.citations).toEqual([]);
});
it("retains partial-read recovery across saved surfaces without including it in creator attribution", async () => {
  const owned = makeSource({ id: "owned-original", fetchPrice: 0.002 });
  const quote = "This original document describes a bounded source observation.";
  const item: SourceItem = { id: "owned-article", sourceId: owned.id, title: "Owned original", summary: "An original observation",
    link: "https://owned-original.example/article", content: quote };
  const engine = fakeEngine(), gateway = fakeGateway(), effects = isolatedTestEffects();
  const attribution = vi.spyOn(engine, "attribute");
  const d = { ...deps([owned], engine, gateway, { items: { [owned.id]: [item] } }), effects };
  d.webSearch = { search: async () => [{ title: "Image PDF", url: "https://scan.example/appendix.pdf", snippet: "Unavailable claims are not evidence" }] };
  d.readWebArticle = async () => { throw new ArticleReadError("pdf-extraction-unavailable"); };
  const run = await collectRun({ question: "Compare the original and appendix", origin: "web", budget: 0.03 }, { deps: d });
  expect(run.answer).toContain("This run did not perform OCR");
  expect(run.answer).toContain(quote);
  expect(run.answer).not.toContain("Unavailable claims are not evidence");
  expect(run.citations.map(citation => citation.sourceId)).toEqual([owned.id]);
  expect(run.totalSpent).toBeCloseTo(owned.fetchPrice + 0.03 * config.citationPoolRatio, 8);
  expect(gateway.citationCalls).toHaveLength(1);
  expect(attribution).toHaveBeenCalledTimes(1);
  const attributed = attribution.mock.calls[0]![0].answer;
  expect(attributed).not.toContain("Next steps to complete");
  expect(run.answer.startsWith(attributed)).toBe(true);
  expect(effects.saveQueryRun).toHaveBeenCalledWith(run);
  const payments = vi.mocked(effects.recordPayment).mock.calls.map(([payment]) => payment);
  const receipt = buildResearchReceipt(run, payments);
  expect(verifyResearchReceipt(receipt).valid).toBe(true);
  expect(receipt.payload.dispatch.answer).toBe(run.answer);
  expect(researchReportMarkdown(run, null, payments)).toContain(run.answer);
  expect(buildAnswerContent(run)).toContain(run.answer);
  for (const result of [remoteResearchResult(run), a2aResponseFromRun(run, quoteA2aResearch(0.03, "quick"))]) {
    expect(JSON.stringify(result)).toContain("This run did not perform OCR");
  }
  for (const result of [surfaceResearch(run), remoteResearchResult(run), keryxMeta(run),
    a2aResponseFromRun(run, quoteA2aResearch(0.03, "quick"))]) {
    expect(result.researchExports).toEqual(exportsFromCheckedReceipt(receipt));
  }
});
it("does not send private questions to external web providers even if a provider is available", async () => {
  const d = deps([], fakeEngine(), fakeGateway()), queryId = `prv_${"9".repeat(64)}`;
  d.effects = isolatedTestEffects(queryId); const search = vi.fn(async () => []); d.webSearch = { search };
  const { steps } = await drive({ question: "Private secret question", queryId }, d);
  expect(search).not.toHaveBeenCalled(); expect(steps.some(step => step.message.includes("withheld for private"))).toBe(true);
});
it("retains free original web decisions when owned-source funding becomes unknown", async () => {
  const d = deps([makeSource({ id: "owned" })], fakeEngine(), fakeGateway());
  d.gateway.ensureFunded = async () => { throw new Error("funding unavailable"); };
  d.webSearch = { search: async () => [{ title: "public", url: "https://publisher.example/article", snippet: "public preview" }] };
  d.readWebArticle = async url => ({ text: "Original public evidence survives unavailable owned funding.", title: "Original", finalUrl: url, kind: "html", truncated: false });
  const { run } = await drive({ question: "Mixed research with unavailable funding", origin: "web" }, d);
  expect(run.decisions.find(decision => decision.sourceKind === "public-reference")?.action).toBe("CACHE");
  expect(run.citations).toHaveLength(1); expect(run.citations[0].sourceKind).toBe("public-reference");
  expect((d.gateway as FakeGateway).fetchCalls).toHaveLength(0); expect((d.gateway as FakeGateway).citationCalls).toHaveLength(0);
});
it("excludes normalized copies and does not spend model decision time from the web read allowance", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  const decide = d.engine.decide.bind(d.engine);
  d.engine.decide = async input => { const decisions = await decide(input); vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60000); return decisions; };
  d.webSearch = { search: async () => [{ title: "a", url: "https://a.example/article", snippet: "relevant" }, { title: "b", url: "https://b.example/article", snippet: "relevant" }] };
  d.readWebArticle = vi.fn(async url => ({ text: "Same original page evidence.", title: "Original", finalUrl: url, kind: "html" as const, truncated: false }));
  try { const { run } = await drive({ question: "Research duplicate evidence", origin: "web" }, d); expect(d.readWebArticle).toHaveBeenCalledTimes(2); expect(run.citations).toHaveLength(1); }
  finally { vi.restoreAllMocks(); }
});
it("blocks unattended external search but allows explicit trusted manual CLI opt-in", async () => {
  const d = deps([], fakeEngine(), fakeGateway()); const search = vi.fn(async () => []); d.webSearch = { search };
  await drive({ question: "Unattended engine question" }, d); expect(search).not.toHaveBeenCalled();
  await drive({ question: "Manual CLI question", origin: "engine", allowExternalWeb: true }, d); expect(search).toHaveBeenCalled();
  const privateId = `prv_${"8".repeat(64)}`; d.effects = isolatedTestEffects(privateId); search.mockClear();
  await drive({ question: "Private question", queryId: privateId, allowExternalWeb: true }, d); expect(search).not.toHaveBeenCalled();
});

it("continues past partial or explicitly incomplete answers, then stops before another affordable read", async () => {
  for (const first of [{ coverage: 0.4, missingRequestedParts: [] },
    { coverage: 0.9, missingRequestedParts: ["Measured latency"] }]) {
    class Assessor extends JsonChatEngine {
      readonly name = "test-json-assessor";
      rows: unknown[] = [];
      protected async chatJson() { return { perClaim: this.rows, rationale: "Synthetic assessment" }; }
    }
    const assessor = new Assessor(), engine = fakeEngine({ decide: input => input.candidates.map((source, index) => ({
      ...buy({ id: source.id, name: source.name, price: source.fetchPrice }), targets: [index % 2],
    })) });
    engine.decompose = async () => ["What is the supported result?", "What is the measured latency?"];
    engine.sufficiency = async input => {
      assessor.rows = input.subClaims.map(() => ({ supportedAnswer: "The supplied text answers the question.",
        coveredBy: input.gathered.map(g => g.marker),
        ...(input.gathered.length < 2 ? first : { coverage: 0.8, missingRequestedParts: [] }) }));
      return assessor.sufficiency(input);
    };
    const gateway = fakeGateway();
    const { run, steps } = await drive({ question: "What is the supported result and measured latency?", budget: 0.05, researchMode: "deep" },
      deps(["alpha", "beta", "gamma"].map(id => makeSource({ id })), engine, gateway));
    expect(gateway.fetchCalls).toHaveLength(2);
    expect(run.totalSpent).toBeLessThanOrEqual(0.05 + EPS);
    expect(steps.some(step => step.message.includes("Stopping early"))).toBe(true);
    // The unread third selection is recorded as skipped, not as a purchase that never happened.
    expect(run.decisions.filter(decision => decision.action === "BUY")).toHaveLength(2);
    expect(run.decisions.find(decision => decision.action === "SKIP")?.rationale).toContain("stopped early");
  }
});

// ── tests ───────────────────────────────────────────────────────────────────

describe("runAgent — money-safety invariants", () => {
  it("keeps zero source authority even when a model proposes paid and zero-priced gateway deliveries", async () => {
    const gateway = fakeGateway();
    const funding = vi.spyOn(gateway, "ensureFunded");
    const d = deps([makeSource({ id: "paid" }), makeSource({ id: "legacy-free", fetchPrice: 0 })], fakeEngine(), gateway);
    const { run } = await drive({ question: "Read what is available without payment", budget: 0, origin: "web", researchMode: "quick" }, d);
    expect(run.budget).toBe(0);
    expect(funding).not.toHaveBeenCalled();
    expect(gateway.fetchCalls).toEqual([]);
    expect(gateway.citationCalls).toEqual([]);
    expect(d.db.payments).toEqual([]);
    expect(run.paymentAttempts).toBe(0);
    expect(run.totalSpent).toBe(0);
  });

  it("bounds Quick mode to two claim-targeted reads and records the preview plan", async () => {
    const sources = ["a", "b", "c"].map((id) => makeSource({ id, fetchPrice: 0.002 }));
    const engine = fakeEngine({
      sufficiency: () => ({ sufficient: false, rationale: "keep reading" }),
      reevaluate: () => ({
        shouldBuyMore: true,
        recommendedIds: ["c"],
        rationale: "deep-only expansion",
      }),
    });
    const gw = fakeGateway();
    const { run, steps } = await drive(
      { question: "q", budget: 0.05, researchMode: "quick" },
      deps(sources, engine, gw),
    );

    expect(gw.fetchCalls).toHaveLength(2);
    expect(run.researchMode).toBe("quick");
    expect(run.previewCoverage).toMatchObject({ status: "ready", coveredClaims: 1 });
    expect(steps.some((step) => step.phase === "reevaluate")).toBe(false);
  });

  it("honors a trusted package snapshot instead of mutable server defaults", async () => {
    const sources = ["a", "b", "c"].map((id) => makeSource({ id, fetchPrice: 0.002 }));
    const engine = fakeEngine({
      sufficiency: () => ({ sufficient: false, rationale: "keep reading" }),
      reevaluate: () => ({
        shouldBuyMore: true,
        recommendedIds: ["b", "c"],
        rationale: "would expand without the package bound",
      }),
    });
    const gw = fakeGateway();
    const { steps } = await drive(
      {
        question: "q",
        budget: 0.05,
        researchMode: "deep",
        executionLimits: { attentionLimit: 1, reevaluateRounds: 0 },
      },
      deps(sources, engine, gw),
    );

    expect(gw.fetchCalls).toHaveLength(1);
    expect(steps.some((step) => step.phase === "reevaluate")).toBe(false);
  });

  it("rejects an invalid trusted execution package before source spend", async () => {
    const gw = fakeGateway();
    await expect(
      drive(
        {
          question: "q",
          budget: 0.05,
          executionLimits: { attentionLimit: 0, reevaluateRounds: 0 },
        },
        deps([makeSource({ id: "a" })], fakeEngine(), gw),
      ),
    ).rejects.toThrow("invalid trusted agent execution limits");
    expect(gw.fetchCalls).toEqual([]);
  });

  it("turns an untargeted BUY into a visible no-spend SKIP", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.002 });
    const engine = fakeEngine({
      decide: (input) => input.candidates.map((candidate) => ({
        ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
        targets: [],
      })),
    });
    const gw = fakeGateway();
    const { run } = await drive({ question: "q", budget: 0.05 }, deps([source], engine, gw));

    expect(gw.fetchCalls).toEqual([]);
    expect(run.totalSpent).toBe(0);
    expect(run.previewCoverage?.status).toBe("insufficient");
    expect(run.decisions[0]).toMatchObject({ action: "SKIP" });
    expect(run.decisions[0]?.rationale).toMatch(/no toll is authorized/i);
    expect(run.answer).toContain("No supported answer");
    expect(run.claimCoverage).toEqual([{ claimIndex: 0, claim: "the sub-claim", coverage: 0, coveredBy: [] }]);
    expect(run.evidence).toEqual([]);
    const receipt = completedA2aServiceReceipt({
      researchPackage: a2aResearchPackage("quick"),
      acceptedAt: run.createdAt, startedAt: run.createdAt, run,
    });
    expect(receipt.quality).toMatchObject({ status: "measured", groundedClaimRate: 0, qualifyingEvidence: 0 });
  });

  it("never spends more on tolls than the fetch budget, even when the engine BUYs everything", async () => {
    const budget = 0.05;
    // Three sources at 0.02 each. fetchBudget = 0.025, so only one fits; the rest must flip to SKIP.
    const sources = ["a", "b", "c"].map((id) => makeSource({ id, fetchPrice: 0.02 }));
    const engine = fakeEngine({
      // Force a real re-eval pass; it must not be able to break the cap either.
      sufficiency: () => ({ sufficient: false, rationale: "keep reading" }),
      reevaluate: () => ({ shouldBuyMore: true, recommendedIds: ["b", "c"], rationale: "fill gaps" }),
    });
    const gw = fakeGateway();
    const d = deps(sources, engine, gw);

    const { run } = await drive({ question: "q", budget }, d);

    const tolls = d.db.payments.filter((p) => p.kind === "fetch").reduce((s, p) => s + p.amountUsdc, 0);
    expect(tolls).toBeLessThanOrEqual(fetchBudget(budget) + EPS);
    expect(gw.fetchCalls.length).toBe(1); // only one 0.02 toll fits under 0.025
    // Over-budget BUYs are recorded as SKIP with a budget-exhausted rationale (visible reasoning).
    const skips = run.decisions.filter((x) => x.action === "SKIP");
    expect(skips.length).toBe(2);
    expect(skips.every((s) => /budget/i.test(s.rationale))).toBe(true);
  });

  it("routes 100% of spend to creator wallets — no platform skim", async () => {
    const budget = 0.05;
    const sources = [makeSource({ id: "a", fetchPrice: 0.004 })];
    const d = deps(sources, fakeEngine(), fakeGateway());

    const { run } = await drive({ question: "q", budget, origin: "web" }, d);

    expect(run.totalToCreators).toBe(run.totalSpent);
    expect(run.totalSpent).toBeGreaterThan(0);
    expect(run.origin).toBe("web");
    expect(run.paymentMode).toBe("real");
    expect(run.paymentAttempts).toBe(2);
    expect(run.settledPayments).toBe(2);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    // Every payment leaves the agent and lands in a creator wallet — never the agent, never a fee sink.
    for (const p of d.db.payments) {
      expect(p.payer).toBe(AGENT);
      expect(p.payee).not.toBe(AGENT);
      expect(["fetch", "citation"]).toContain(p.kind);
    }
    // totalSpent equals the sum of every recorded payment.
    const sum = round(d.db.payments.reduce((s, p) => s + p.amountUsdc, 0));
    expect(run.totalSpent).toBe(sum);
  });

  it("splits a multi-author citation reward across authors; legs sum to the reward", async () => {
    const budget = 0.05;
    const authors: Author[] = [
      { name: "Mara", walletAddress: "0xmara", splitWeight: 0.6 },
      { name: "Devin", walletAddress: "0xdevin", splitWeight: 0.4 },
    ];
    const sources = [makeSource({ id: "a", fetchPrice: 0.004, authors })];
    // Single source cited at full weight → reward = whole citation pool.
    const engine = fakeEngine({ attribute: (used) => used.map((u) => ({ sourceId: u.sourceId, weight: 1, rationale: "sole source" })) });
    const gw = fakeGateway();
    const d = deps(sources, engine, gw);

    const { run } = await drive({ question: "q", budget }, d);

    const reward = citationPool(budget);
    const legs = gw.citationCalls.filter((c) => c.sourceId === "a");
    expect(legs.length).toBe(2);
    expect(legs.find((l) => l.payee === "0xmara")!.amount).toBeCloseTo(round(reward * 0.6), 9);
    expect(legs.find((l) => l.payee === "0xdevin")!.amount).toBeCloseTo(round(reward * 0.4), 9);
    const legSum = legs.reduce((s, l) => s + l.amount, 0);
    expect(legSum).toBeCloseTo(reward, 9);
    // And the single citation reward equals the pool.
    expect(run.citations[0].reward).toBeCloseTo(reward, 9);
  });

  it("settles an even 3-author split whose legs sum to exactly the reward (no drift)", async () => {
    const budget = 0.02; // pool = 0.01 → reward 0.01 across 3 authors: naive rounding would drift
    const authors: Author[] = [
      { name: "A", walletAddress: "0xa", splitWeight: 1 / 3 },
      { name: "B", walletAddress: "0xb", splitWeight: 1 / 3 },
      { name: "C", walletAddress: "0xc", splitWeight: 1 / 3 },
    ];
    const sources = [makeSource({ id: "s", fetchPrice: 0.004, authors })];
    const engine = fakeEngine({ attribute: (used) => used.map((u) => ({ sourceId: u.sourceId, weight: 1, rationale: "sole" })) });
    const gw = fakeGateway();
    const d = deps(sources, engine, gw);

    const { run } = await drive({ question: "q", budget }, d);

    const reward = run.citations[0].reward;
    const legMicros = gw.citationCalls.map((c) => Math.round(c.amount * 1e6));
    expect(legMicros.length).toBe(3);
    expect(legMicros.reduce((s, m) => s + m, 0)).toBe(Math.round(reward * 1e6)); // exact
  });

  it("distributes the full citation pool when cited weights sum to 1", async () => {
    const budget = 0.05;
    const sources = ["a", "b"].map((id) => makeSource({ id, fetchPrice: 0.005 }));
    const engine = fakeEngine({
      sufficiency: () => ({ sufficient: false, rationale: "read both" }), // buy both before answering
      attribute: (used) => used.map((u) => ({ sourceId: u.sourceId, weight: 0.5, rationale: "half each" })),
    });
    const gw = fakeGateway();
    const d = deps(sources, engine, gw);

    await drive({ question: "q", budget }, d);

    const pool = citationPool(budget);
    const paidRewards = gw.citationCalls.reduce((s, c) => s + c.amount, 0);
    expect(paidRewards).toBeCloseTo(pool, 9);
  });

  it.each([
    { chain: "Base", onArc: false },
    { chain: "Arc mainnet", onArc: true },
    { chain: "Arc testnet", onArc: true },
  ])("never purchases external marketplace endpoints advertising $chain — they are forced to SKIP", async ({ chain, onArc }) => {
    const budget = 0.05;
    const sources = [makeSource({ id: "a", fetchPrice: 0.004 })];
    // Engine proposes BUYing an external endpoint too; the orchestrator must veto it.
    const engine = fakeEngine({
      decide: (i) => [
        ...i.candidates.filter((c) => !c.id.startsWith("ext:")).map((c) => buy({ id: c.id, name: c.name, price: c.fetchPrice })),
        {
          sourceId: "ext:https://paid.example/api",
          sourceName: "External API",
          action: "BUY",
          expectedValue: 0.9,
          price: 0.01,
          confidence: 0.9,
          rationale: "looks useful",
          targets: [0],
        },
      ],
    });
    const gw = fakeGateway();
    const d = deps(sources, engine, gw);
    d.discoverExternal = vi.fn(async () => [{
      id: "ext:https://paid.example/api", name: "External API", description: "Advertised paid API", tags: [],
      fetchPrice: 0.01, cached: false, preview: "External metadata",
      external: { resource: "https://paid.example/api", chains: [chain], payTo: "0xexternal", onArc },
    }]);

    const { run, steps } = await drive({ question: "q", budget, researchMode: "deep" }, d);

    expect(d.discoverExternal).toHaveBeenCalledOnce();
    const ext = run.decisions.find((x) => x.sourceId.startsWith("ext:"));
    expect(ext).toBeDefined();
    expect(ext!.action).toBe("SKIP");
    expect(ext!.external).toBe(true);
    expect(ext!.rationale).toContain(`advertises acceptance on ${chain}`);
    expect(ext!.rationale).toContain("discovery-only");
    expect(steps.some(step => step.message.includes(`advertise acceptance on ${chain}`))).toBe(true);
    // No fetch call and no payment ever references an external endpoint.
    expect(gw.fetchCalls.some((id) => id.startsWith("ext:"))).toBe(false);
    expect(d.db.payments.some((p) => p.sourceId.startsWith("ext:"))).toBe(false);
  });

  it("keeps unverified sources off the money path (listed, but never read or paid)", async () => {
    const budget = 0.05;
    const sources = [
      makeSource({ id: "ok", fetchPrice: 0.004, verified: true }),
      makeSource({ id: "unverified", fetchPrice: 0.004, walletAddress: "0ximpostor", verified: false }),
    ];
    const engine = fakeEngine();
    const gw = fakeGateway();
    const d = deps(sources, engine, gw);

    await drive({ question: "q", budget }, d);

    // The unverified source is never even offered to the decide() step.
    const offered = engine.decideInput!.candidates.map((c) => c.id);
    expect(offered).toContain("ok");
    expect(offered).not.toContain("unverified");
    // ...and never fetched or paid.
    expect(gw.fetchCalls).not.toContain("unverified");
    expect(d.db.payments.some((p) => p.payee === "0ximpostor")).toBe(false);
  });

  it("degrades gracefully when a single toll fails — still answers from what it read", async () => {
    const budget = 0.05;
    const sources = ["a", "b"].map((id) => makeSource({ id, fetchPrice: 0.004 }));
    const engine = fakeEngine({ sufficiency: () => ({ sufficient: false, rationale: "read both" }) });
    const gw = fakeGateway({ failOn: "a" }); // first toll blows up
    const d = deps(sources, engine, gw);

    const { run } = await drive({ question: "q", budget }, d);

    expect(gw.fetchCalls).toEqual(["b"]); // "a" failed, "b" still bought
    expect(run.answer).toBeTruthy();
    expect(run.citations.length).toBeGreaterThan(0); // answered + settled from the survivor
    // The failed toll charged nothing.
    expect(d.db.payments.some((p) => p.sourceId === "a" && p.kind === "fetch")).toBe(false);
  });

  it("persists an ambiguous post-signature toll as pending without counting it as spent", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const engine = fakeEngine();
    const gw = fakeGateway();
    gw.payFetch = async ({ source: candidate, queryId }) => {
      const payment = makePayment({
        id: "x402:nonce-a",
        kind: "fetch",
        queryId,
        sourceId: candidate.id,
        sourceName: candidate.name,
        payer: AGENT,
        payee: candidate.walletAddress,
        amountUsdc: candidate.fetchPrice,
        settled: false,
        settlementStatus: "pending",
        authorizationId: "nonce-a",
      });
      throw new PaymentPendingError("confirmation pending", payment);
    };
    const d = deps([source], engine, gw);

    const { run, steps } = await drive({ question: "q", budget: 0.05 }, d);

    expect(run.totalSpent).toBe(0);
    expect(run.totalToCreators).toBe(0);
    expect(run.paymentAttempts).toBe(1);
    expect(run.settledPayments).toBe(0);
    expect(run.pendingPayments).toBe(1);
    expect(run.pendingSpendUsdc).toBe(0.004);
    expect(run.answer).toContain("remains pending");
    expect(d.db.payments).toHaveLength(1);
    expect(d.db.payments[0]).toMatchObject({
      settlementStatus: "pending",
      settled: false,
      authorizationId: "nonce-a",
    });
    expect(steps.some((step) => step.message.includes("confirmation is pending"))).toBe(true);
  });

  it.each(["exposed", "submission_attempted"] as const)(
    "retains query budget after uncertain %s journal transition without inserting a second ledger row",
    async (phase) => {
      const sources = [
        makeSource({ id: "a", fetchPrice: 0.004 }),
        makeSource({ id: "b", fetchPrice: 0.004 }),
      ];
      const engine = fakeEngine({
        decide: (input) =>
          input.candidates.map((c) => ({
            ...buy({ id: c.id, name: c.name, price: c.fetchPrice }),
            action: c.id === "a" ? "BUY" : "SKIP",
          })),
        sufficiency: () => ({
          sufficient: false,
          rationale: "no delivered evidence",
        }),
        reevaluate: () => ({
          shouldBuyMore: true,
          recommendedIds: ["b"],
          rationale: "try next source",
        }),
      });
      const gateway = fakeGateway();
      const attempts: string[] = [];
      gateway.payFetch = async ({ source, queryId }) => {
        attempts.push(source.id);
        throw new PaymentPendingError(
          "journal transition acknowledgement uncertain",
          makePayment({
            kind: "fetch",
            queryId,
            sourceId: source.id,
            sourceName: source.name,
            payer: AGENT,
            payee: source.walletAddress,
            amountUsdc: source.fetchPrice,
            settled: false,
            settlementStatus: "pending",
            authorizationId: "known-nonce",
            authorizationPhase: phase,
          }),
          false
        );
      };
      const d = deps(sources, engine, gateway);
      const { run, steps } = await drive(
        {
          question: "q",
          budget: 0.004 / (1 - config.citationPoolRatio),
          researchMode: "deep",
        },
        d
      );
      expect(attempts).toEqual(["a"]);
      expect(run.pendingSpendUsdc).toBe(0.004);
      expect(run.totalSpent).toBe(0);
      expect(run.answer).toBeTruthy();
      expect(d.db.payments).toEqual([]);
      if (phase === "exposed")
        expect(steps.some((s) => s.message.includes("possibly unsigned"))).toBe(
          true
        );
    }
  );

  it("retains a settled toll when content delivery fails and continues without the source", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const gw = fakeGateway();
    gw.payFetch = async ({ source: candidate, queryId }) => {
      const payment = makePayment({
        id: "x402:nonce-a",
        kind: "fetch",
        queryId,
        sourceId: candidate.id,
        sourceName: candidate.name,
        payer: AGENT,
        payee: candidate.walletAddress,
        amountUsdc: candidate.fetchPrice,
        settled: true,
        settlementStatus: "settled",
        txHash: "circle-settlement-id",
        authorizationId: "nonce-a",
      });
      throw new PaymentSettledError("content unavailable", payment);
    };
    const d = deps([source], fakeEngine(), gw);

    const { run, steps } = await drive({ question: "q", budget: 0.05 }, d);

    expect(run.totalSpent).toBe(source.fetchPrice);
    expect(run.totalToCreators).toBe(source.fetchPrice);
    expect(run.settledPayments).toBe(1);
    expect(run.pendingPayments).toBe(0);
    expect(run.citations).toHaveLength(0);
    expect(run.answer).toContain("source payments settled");
    expect(run.answer).not.toContain("before submission");
    expect(run.claimCoverage?.[0]?.coverage).toBe(0);
    expect(d.db.payments).toHaveLength(1);
    expect(d.db.payments[0]).toMatchObject({
      settled: true,
      settlementStatus: "settled",
      txHash: "circle-settlement-id",
    });
    expect(steps.some((step) => step.message.includes("content response failed after settlement"))).toBe(true);
  });

  it("retains a settled citation reward when its paid acknowledgement fails", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const gw = fakeGateway();
    gw.payCitation = async ({ source: cited, author, amount, weight, queryId, rationale }) => {
      const payment = makePayment({
        id: "x402:nonce-cite",
        kind: "citation",
        queryId,
        sourceId: cited.id,
        sourceName: cited.name,
        payer: AGENT,
        payee: author.walletAddress,
        amountUsdc: amount,
        weight,
        rationale,
        settled: true,
        settlementStatus: "settled",
        txHash: "circle-citation-settlement-id",
        authorizationId: "nonce-cite",
      });
      throw new PaymentSettledError("acknowledgement unavailable", payment);
    };
    const d = deps([source], fakeEngine(), gw);

    const { run, steps } = await drive({ question: "q", budget: 0.05 }, d);

    expect(run.citations).toHaveLength(1);
    expect(run.settledPayments).toBe(2);
    expect(run.pendingPayments).toBe(0);
    expect(run.totalSpent).toBeGreaterThan(source.fetchPrice);
    expect(d.db.payments).toHaveLength(2);
    expect(d.db.payments.find((p) => p.kind === "citation")).toMatchObject({
      settled: true,
      settlementStatus: "settled",
      txHash: "circle-citation-settlement-id",
    });
    expect(steps.some((step) => step.message.includes("acknowledgement failed"))).toBe(true);
  });

  it("does not relabel a settled payment as a failed purchase when the ledger write fails", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const d = deps([source], fakeEngine(), fakeGateway());
    d.db.recordPayment = async () => {
      throw new Error("database unavailable");
    };

    const { run, steps } = await drive({ question: "q", budget: 0.05 }, d);

    expect(run.answer).toContain("“content:a.” [S1]");
    expect(run.totalSpent).toBeGreaterThan(0);
    expect(run.settledPayments).toBe(2);
    expect(steps.some((step) => step.message.includes("receipt retained"))).toBe(true);
    expect(steps.some((step) => step.message.includes("Couldn't buy"))).toBe(false);
  });

  it("withholds every citation reward when a negative answer has zero evidence (CCTP regression)", async () => {
    const sources = ["a", "b"].map((id) =>
      makeSource({ id, fetchPrice: 0.004 }),
    );
    const cacheDecision = (source: Source): Decision => ({
      ...buy({
        id: source.id,
        name: source.name,
        price: source.fetchPrice,
      }),
      action: "CACHE",
    });
    const engine = fakeEngine({
      decide: () => sources.map(cacheDecision),
      sufficiency: (input) => ({
        sufficient: false,
        rationale: "nothing covers CCTP",
        perClaim: input.subClaims.map((claim) => ({
          claim,
          coverage: 0,
          coveredBy: [],
        })),
      }),
      synthesize: () => ({
        answer:
          "The provided sources do not contain information about CCTP.",
        citedMarkers: [],
        evidence: [],
      }),
    });
    const gw = fakeGateway();
    const d = deps(sources, engine, gw, {
      cachedAt: {
        a: "2026-07-28T00:00:00.000Z",
        b: "2026-07-28T00:00:00.000Z",
      },
    });

    const { run, steps } = await drive(
      { question: "How does CCTP work?", budget: 0.04 },
      d,
    );

    expect(run.citations).toEqual([]);
    expect(run.evidence).toEqual([]);
    expect(run.claimCoverage?.[0]?.coverage).toBe(0);
    expect(run.confidence?.level).toBe("Low");
    expect(gw.citationCalls).toEqual([]);
    expect(
      d.db.payments.some((payment) => payment.kind === "citation"),
    ).toBe(false);
    expect(
      steps.some(
        (step) =>
          step.phase === "evidence" &&
          /citation pool stays unspent/i.test(step.message),
      ),
    ).toBe(true);
  });

  it("finishes the answer but fails citation rewards closed when the final assessment errors", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const engine = fakeEngine({
      decide: () => [
        {
          ...buy({
            id: source.id,
            name: source.name,
            price: source.fetchPrice,
          }),
          action: "CACHE",
        },
      ],
      sufficiency: () => {
        throw new Error("assessment transport unavailable");
      },
    });
    const gw = fakeGateway();
    const d = deps([source], engine, gw, {
      cachedAt: { a: "2026-07-28T00:00:00.000Z" },
    });

    const { run, steps } = await drive(
      { question: "q", budget: 0.05 },
      d,
    );

    expect(run.answer).toContain("draft is withheld");
    expect(run.answer).not.toContain("grounded answer");
    expect(run.citations).toEqual([]);
    expect(run.confidence?.level).toBe("Low");
    expect(gw.citationCalls).toEqual([]);
    expect(
      steps.some(
        (step) =>
          step.phase === "sufficiency" &&
          /continuing conservatively/i.test(step.message),
      ),
    ).toBe(true);
  });

  it("surfaces relevance review failure while withholding unsupported prose and rewards", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const engine = fakeEngine({ synthesize: (input) => ({
      answer: "The completed draft [S1].", citedMarkers: ["S1"], evidenceReview: "unavailable",
      evidence: input.gathered.map((g) => ({ claimIndex: 0, marker: g.marker, quote: g.text, support: 0 })),
    }) });
    const gw = fakeGateway();
    const { run, steps } = await drive({ question: "q", budget: 0.05 }, deps([source], engine, gw));
    expect(run.answer).toContain("draft is withheld");
    expect(run.answer).not.toContain("completed draft");
    expect(run.citations).toEqual([]);
    expect(gw.citationCalls).toEqual([]);
    expect(steps.some((step) => step.phase === "evidence" && /relevance review unavailable/i.test(step.message))).toBe(true);
  });

  it("rejects a citation whose proposed quote does not occur in the paid source", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const engine = fakeEngine({
      synthesize: () => ({
        answer: "A claim that looks grounded [S1].",
        citedMarkers: ["S1"],
        evidence: [
          {
            claimIndex: 0,
            marker: "S1",
            quote: "fabricated evidence that is not in the source",
            support: 1,
          },
        ],
      }),
    });
    const gw = fakeGateway();
    const d = deps([source], engine, gw);

    const { run } = await drive(
      { question: "q", budget: 0.05 },
      d,
    );

    expect(run.citations).toEqual([]);
    expect(run.evidence).toEqual([]);
    expect(gw.citationCalls).toEqual([]);
    expect(
      d.db.payments.filter((payment) => payment.kind === "fetch"),
    ).toHaveLength(1);
    expect(run.totalSpent).toBe(source.fetchPrice);
  });

  it("never lets incomplete attribution redirect an evidence-verified citation pool", async () => {
    const sources = ["a", "b"].map((id) =>
      makeSource({ id, fetchPrice: 0.004 }),
    );
    const engine = fakeEngine({
      sufficiency: (input) => ({
        sufficient: false,
        rationale: "read every candidate",
        perClaim: input.subClaims.map((claim) => ({
          claim,
          coverage: 0.9,
          coveredBy: input.gathered.map((g) => g.marker),
        })),
      }),
      attribute: () => [
        { sourceId: "ghost", weight: 1, rationale: "redirect" },
      ],
    });
    const gw = fakeGateway();
    const d = deps(sources, engine, gw);

    const { run } = await drive(
      { question: "q", budget: 0.05 },
      d,
    );

    expect(run.citations).toHaveLength(2);
    expect(run.citations.map((citation) => citation.sourceId)).toEqual([
      "a",
      "b",
    ]);
    expect(run.citations.every((citation) => citation.weight === 0.5)).toBe(
      true,
    );
    expect(
      run.citations.every((citation) =>
        /evidence-validated/i.test(citation.rationale),
      ),
    ).toBe(true);
    expect(
      gw.citationCalls.some((call) => call.sourceId === "ghost"),
    ).toBe(false);
  });

  it("falls back to the configured default budget when none is provided", async () => {
    const sources = [makeSource({ id: "a", fetchPrice: 0.004 })];
    const d = deps(sources, fakeEngine(), fakeGateway());

    const { run } = await drive({ question: "q" }, d); // no budget

    expect(run.budget).toBe(config.defaultBudget);
  });
});

describe("runAgent — article-level economics", () => {
  const cache = (id: string) => ({ [id]: new Date().toISOString() });
  const cacheDecision = (id: string, name = id.toUpperCase()): Decision => ({
    sourceId: id,
    sourceName: name,
    action: "CACHE",
    expectedValue: 0.9,
    price: 0.004,
    confidence: 0.9,
    rationale: "already read this one",
    targets: [0],
  });

  it("keeps the strongest cached evidence when cheaper list prices would previously crowd it out", async () => {
    const sources = [
      makeSource({ id: "exact", fetchPrice: 0.004 }),
      makeSource({ id: "cheap", fetchPrice: 0.002 }),
      makeSource({ id: "cheapest", fetchPrice: 0.001 }),
    ];
    const expectedValue: Record<string, number> = {
      exact: 0.88,
      cheap: 0.8,
      cheapest: 0.7,
    };
    const engine = fakeEngine({
      decide: (input) =>
        input.candidates.map((candidate) => ({
          ...cacheDecision(candidate.id, candidate.name),
          expectedValue: expectedValue[candidate.id]!,
        })),
      sufficiency: (input) => ({
        sufficient: false,
        rationale: "inspect the whole selected portfolio",
        perClaim: input.subClaims.map((claim) => ({ claim, coverage: 0, coveredBy: [] })),
      }),
      synthesize: () => ({ answer: "No supported answer.", citedMarkers: [], evidence: [] }),
    });
    const d = deps(sources, engine, fakeGateway(), {
      cachedAt: Object.fromEntries(sources.map((source) => [source.id, new Date().toISOString()])),
    });

    const { run } = await drive(
      { question: "the exact cached evidence", budget: 0.05, researchMode: "quick" },
      d,
    );

    expect(run.decisions.find((decision) => decision.sourceId === "exact")).toMatchObject({
      action: "CACHE",
      expectedValue: 0.88,
    });
    expect(run.decisions.find((decision) => decision.sourceId === "cheapest")).toMatchObject({
      action: "SKIP",
    });
    expect(run.evidencePortfolio?.selectedAssetIds).toEqual(["exact", "cheap"]);
    expect(run.evidencePortfolio?.selectedBuyUsdc).toBe(0);
  });

  it("selects and receipts the relevant article rather than buying the whole feed", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const relevant: SourceItem = {
      id: "arc-settlement",
      sourceId: "a",
      title: "Arc settlement reaches deterministic finality",
      summary: "A technical note about Arc settlement evidence.",
      content: "Arc settlement evidence is retained after paid delivery fails.",
      link: "https://a.example/arc-settlement",
      publishedAt: "2026-07-19T00:00:00.000Z",
    };
    const newerButIrrelevant: SourceItem = {
      id: "football",
      sourceId: "a",
      title: "Football results",
      summary: "A weekly sports roundup.",
      content: "The home team won its match this week.",
      link: "https://a.example/football",
      publishedAt: "2026-07-20T00:00:00.000Z",
    };
    const gw = fakeGateway();
    const d = deps([source], fakeEngine(), gw, {
      items: { a: [newerButIrrelevant, relevant] },
    });

    const { run } = await drive(
      { question: "How does Arc settlement retain evidence?", budget: 0.05 },
      d,
    );

    expect(gw.fetchItems).toEqual([relevant.id]);
    expect(run.decisions[0]).toMatchObject({
      assetId: `item:${relevant.id}`,
      sourceId: source.id,
      itemId: relevant.id,
      itemTitle: relevant.title,
    });
    expect(run.citations[0]).toMatchObject(sourceItemIdentity(relevant));
    expect(run.evidence?.[0]).toMatchObject(sourceItemIdentity(relevant));
    expect(d.db.payments.every((payment) => payment.itemId === relevant.id)).toBe(true);
  });

  it("admits an exact wanted-response article without forcing the model to buy it", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const organic: SourceItem = {
      id: "organic",
      sourceId: source.id,
      title: "Arc settlement evidence",
      summary: "The obvious keyword match",
      content: "Organic evidence",
      link: "https://a.example/organic",
    };
    const offered: SourceItem = {
      id: "offered",
      sourceId: source.id,
      title: "Creator response",
      summary: "A less obvious public preview",
      content: "The exact offered evidence",
      link: "https://a.example/offered",
    };
    const engine = fakeEngine({
      decide: (input) => [{
        sourceId: input.candidates[0].id,
        sourceName: input.candidates[0].name,
        action: "SKIP",
        expectedValue: 0.2,
        price: input.candidates[0].fetchPrice,
        confidence: 0.9,
        rationale: "the offered preview is not worth its toll",
        targets: [0],
      }],
    });
    const gw = fakeGateway();
    const d = deps([source], engine, gw, { items: { a: [organic, offered] } });

    const { run, steps } = await drive({
      question: "How does Arc settlement retain evidence?",
      budget: 0.05,
      targetAsset: {
        sourceId: source.id,
        itemId: offered.id,
        contentVersion: sourceItemContentVersion(offered),
      },
    }, d);

    expect(engine.decideInput?.candidates[0]).toMatchObject({
      id: "item:offered",
      item: { itemId: offered.id },
    });
    expect(run.decisions[0]).toMatchObject({ action: "SKIP", itemId: offered.id });
    expect(gw.fetchItems).toEqual([]);
    expect(steps.some((step) => step.message.includes("still decides BUY or SKIP"))).toBe(true);
  });

  it("uses a creator-signed article offer as the trusted decision and payment price", async () => {
    const account = privateKeyToAccount(`0x${"33".repeat(32)}`);
    const source = makeSource({
      id: "a",
      walletAddress: account.address,
      fetchPrice: 0.004,
    });
    const item: SourceItem = {
      id: "offer-article",
      sourceId: source.id,
      title: "Agent offer markets",
      summary: "Signed article discounts for autonomous buyers",
      content: "Signed article discounts let autonomous buyers compare exact evidence costs.",
      link: "https://a.example/offer-article",
    };
    const message = {
      sourceId: source.id,
      itemId: item.id,
      contentVersion: sourceItemContentVersion(item),
      priceUsdc6: 1_000,
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      nonce: `0x${"ef".repeat(32)}` as `0x${string}`,
    };
    const signature = await account.signTypedData(articleOfferTypedData(message));
    const offer: ArticleOffer = {
      id: articleOfferId(signature),
      ...message,
      signer: account.address,
      signature,
      createdAt: new Date().toISOString(),
    };
    const engine = fakeEngine({
      // A broken model substitutes a near-zero price; the orchestrator must restore verified terms.
      decide: (input) => [
        buy({ id: input.candidates[0].id, name: input.candidates[0].name, price: 0.000001 }),
      ],
    });
    const gw = fakeGateway();
    const d = deps([source], engine, gw, {
      items: { [source.id]: [item] },
      offers: { [`${source.id}:${item.id}`]: offer },
    });

    const { run, steps } = await drive(
      { question: "How do agent offer markets work?", budget: 0.01 },
      d,
    );

    expect(engine.decideInput?.candidates[0].fetchPrice).toBe(0.001);
    expect(run.decisions[0]).toMatchObject({
      price: 0.001,
      offerId: offer.id,
      listPrice: 0.004,
    });
    expect(gw.fetchPrices).toEqual([0.001]);
    expect(gw.fetchOffers).toEqual([offer.id]);
    expect(d.db.payments.find((payment) => payment.kind === "fetch")).toMatchObject({
      amountUsdc: 0.001,
      offerId: offer.id,
      listPriceUsdc: 0.004,
    });
    expect(steps.some((step) => /creator-signed article offer/i.test(step.message))).toBe(true);
  });

  it("cannot pay twice when a model duplicates the same article decision", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const item: SourceItem = {
      id: "article-1",
      sourceId: source.id,
      title: "Arc settlement",
      summary: "Arc settlement preview",
      content: "Arc settlement content long enough for evidence.",
      link: "https://a.example/article-1",
    };
    const engine = fakeEngine({
      decide: (input) => {
        const candidate = input.candidates[0];
        const decision = buy({
          id: candidate.id,
          name: candidate.name,
          price: candidate.fetchPrice,
        });
        return [decision, { ...decision }];
      },
    });
    const gw = fakeGateway();
    const d = deps([source], engine, gw, { items: { a: [item] } });

    const { run } = await drive({ question: "Arc settlement", budget: 0.05 }, d);

    expect(run.decisions).toHaveLength(1);
    expect(gw.fetchItems).toEqual([item.id]);
  });

  it("buys an exact article when only the old source-bundle cache exists", async () => {
    const sources = [makeSource({ id: "a", fetchPrice: 0.004 })];
    const engine = fakeEngine({ decide: () => [cacheDecision("a")] });
    const gw = fakeGateway();
    const d = deps(sources, engine, gw, {
      cachedAt: cache("a"),
      newestItem: { a: "2026-07-24T00:00:00.000Z" }, // published since
    });

    const { run } = await drive({ question: "q", budget: 0.05 }, d);

    expect(engine.decideInput?.candidates[0].cached).toBe(false); // offered as a paid read
    expect(run.decisions[0].action).toBe("BUY");
    expect(run.decisions[0].rationale).toContain("exact content version");
    expect(gw.fetchCalls).toEqual(["a"]);
    expect(d.db.payments.filter((p) => p.kind === "fetch")).toHaveLength(1);
  });

  it("reuses a cached immutable article version for free", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const item: SourceItem = {
      id: "a-i1",
      sourceId: "a",
      title: "post",
      summary: "summary",
      content: "article content long enough for evidence",
      link: "https://example.test/post",
      publishedAt: "2026-07-19T00:00:00.000Z",
    };
    const cacheKey = sourceItemCacheKey(source.id, item);
    const engine = fakeEngine({ decide: () => [cacheDecision("a")] });
    const gw = fakeGateway();
    const d = deps([source], engine, gw, {
      items: { a: [item] },
      cachedByKey: { [cacheKey]: new Date().toISOString() },
    });

    const { run } = await drive({ question: "q", budget: 0.05 }, d);

    expect(engine.decideInput?.candidates[0].cached).toBe(true);
    expect(run.decisions[0].action).toBe("CACHE");
    expect(gw.fetchCalls).toEqual([]);
    expect(d.db.payments.some((p) => p.kind === "fetch")).toBe(false);
    expect(run.citations.length).toBeGreaterThan(0); // a cached read still earns a citation reward
  });

  it("buys again once a cached article is older than the reuse window, and scopes browser-funded reads to the payer", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const item: SourceItem = {
      id: "a-i1", sourceId: "a", title: "post", summary: "summary",
      content: "article content long enough for evidence", link: "https://example.test/post",
      publishedAt: "2026-07-19T00:00:00.000Z",
    };
    const cacheKey = sourceItemCacheKey(source.id, item);
    const expired = new Date(Date.now() - (config.cacheTtlSeconds + 60) * 1000).toISOString();
    const stale = deps([source], fakeEngine({ decide: () => [cacheDecision("a")] }), fakeGateway(), {
      items: { a: [item] }, cachedByKey: { [cacheKey]: expired },
    });
    expect((await drive({ question: "q", budget: 0.05 }, stale)).run.decisions[0].action).toBe("BUY");

    // Someone else's fresh shared copy is not a free read for a wallet funding its own session.
    const payer = "0x00000000000000000000000000000000000000aa";
    const engine = fakeEngine({ decide: () => [cacheDecision("a")] });
    const other = deps([source], engine, fakeGateway(), {
      items: { a: [item] }, cachedByKey: { [cacheKey]: new Date().toISOString() },
    });
    await drive({ question: "q", budget: 0.05, asker: payer, fundingOwner: "browser" }, other);
    expect(engine.decideInput?.candidates[0].cached).toBe(false);

    const own = deps([source], engine, fakeGateway(), {
      items: { a: [item] }, cachedByKey: { [`payer:${payer}:${cacheKey}`]: new Date().toISOString() },
    });
    await drive({ question: "q", budget: 0.05, asker: payer, fundingOwner: "browser" }, own);
    expect(engine.decideInput?.candidates[0].cached).toBe(true);
  });

  it("keeps a source that pays the asker out of a run the asker does not fund", async () => {
    const asker = "0x00000000000000000000000000000000000000bb";
    const sources = [
      makeSource({ id: "mine", walletAddress: asker.toUpperCase().replace("0X", "0x") }),
      makeSource({ id: "coauthored", authors: [{ name: "me", walletAddress: asker, splitWeight: 1 }] }),
      makeSource({ id: "other" }),
    ];
    const engine = fakeEngine();
    const { run, steps } = await drive({ question: "q", budget: 0.05, asker, fundingOwner: "treasury" },
      deps(sources, engine, fakeGateway()));
    expect(engine.decideInput?.candidates.map((candidate) => candidate.sourceId)).toEqual(["other"]);
    expect(run.decisions.some((decision) => decision.sourceId !== "other")).toBe(false);
    expect(steps.some((step) => step.message.includes("pay the asking wallet"))).toBe(true);

    // A wallet spending its own browser grant may buy its own work: no outside money is involved.
    const funded = fakeEngine();
    await drive({ question: "q", budget: 0.05, asker, fundingOwner: "browser" }, deps(sources, funded, fakeGateway()));
    expect(funded.decideInput?.candidates).toHaveLength(3);
  });

  it.each([0.08, 0.119, 0.12, 0.2])("skips low-value cached content at EV %s because free bytes still consume attention", async expectedValue => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const engine = fakeEngine({
      decide: () => [{ ...cacheDecision("a"), expectedValue }],
    });
    const d = deps([source], engine, fakeGateway(), {
      cachedAt: cache("a"),
    });

    const { run } = await drive({ question: "q", budget: 0.05 }, d);

    expect(run.decisions[0]).toMatchObject({ action: "SKIP" });
    expect(run.decisions[0]?.rationale).toContain(expectedValue < 0.12 ? "spend floor" : "attention gate");
    expect(run.citations).toEqual([]);
  });

  it("bounds synthesis context and leaves redundant attention slots unused", async () => {
    const sources = Array.from({ length: config.maxAttentionSources + 1 }, (_, index) =>
      makeSource({ id: `s${index}`, fetchPrice: 0.001 }),
    );
    const engine = fakeEngine({
      decide: () => sources.map((source) => cacheDecision(source.id, source.name)),
      sufficiency: (input) => ({
        sufficient: false,
        rationale: "inspect admitted context",
        perClaim: input.subClaims.map((claim) => ({ claim, coverage: 0, coveredBy: [] })),
      }),
      synthesize: () => ({ answer: "No supported answer.", citedMarkers: [], evidence: [] }),
    });
    const d = deps(sources, engine, fakeGateway(), {
      cachedAt: Object.fromEntries(sources.map((source) => [source.id, new Date().toISOString()])),
    });

    const { run } = await drive({ question: "q", budget: 0.05 }, d);

    expect(run.decisions.filter((decision) => decision.action === "CACHE")).toHaveLength(2);
    expect(run.evidencePortfolio).toMatchObject({
      eligibleCandidates: config.maxAttentionSources + 1,
      attentionLimit: config.maxAttentionSources,
    });
    expect(
      run.decisions.some(
        (decision) => decision.action === "SKIP" && decision.rationale.includes("less redundant"),
      ),
    ).toBe(true);
  });

  it("releases failed context and query-budget reservations for a gap-filling source", async () => {
    const sources = Array.from({ length: config.maxAttentionSources + 1 }, (_, index) =>
      makeSource({ id: `s${index}`, fetchPrice: 0.001 }),
    );
    const engine = fakeEngine({
      sufficiency: () => ({ sufficient: false, rationale: "one source failed" }),
      reevaluate: () => ({
        shouldBuyMore: true,
        recommendedIds: [`s${config.maxAttentionSources}`],
        rationale: "replace the failed read",
      }),
    });
    const gw = fakeGateway({ failOn: "s0" });
    const d = deps(sources, engine, gw);

    await drive({ question: "q", budget: 0.05 }, d);

    expect(gw.fetchCalls).toContain(`s${config.maxAttentionSources}`);
    expect(gw.fetchCalls).toHaveLength(2);
  });

  it("skips rather than overspends when exact article versions are not cached", async () => {
    // fetchBudget on 0.01 is 0.005; two uncached article reads at 0.004 cannot both be bought.
    const sources = ["a", "b"].map((id) => makeSource({ id, fetchPrice: 0.004 }));
    const engine = fakeEngine({ decide: () => [cacheDecision("a"), cacheDecision("b")] });
    const gw = fakeGateway();
    const d = deps(sources, engine, gw, {
      cachedAt: { ...cache("a"), ...cache("b") },
      newestItem: { a: "2026-07-24T00:00:00.000Z", b: "2026-07-24T00:00:00.000Z" },
    });

    const budget = 0.01;
    const { run } = await drive({ question: "q", budget }, d);

    const tolls = d.db.payments
      .filter((p) => p.kind === "fetch")
      .reduce((sum, p) => sum + p.amountUsdc, 0);
    expect(tolls).toBeLessThanOrEqual(fetchBudget(budget) + 1e-9);
    expect(run.decisions.filter((x) => x.action === "SKIP")).toHaveLength(1);
    expect(run.decisions.some((x) => x.action === "CACHE")).toBe(false);
  });
});

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Complete synthetic effect sink; not a production private store or privacy guarantee. */
function isolatedTestEffects(queryId?: string): ResearchEffects {
  return {
    scope: queryId ? { kind: "job", queryId } : { kind: "public" },
    recordPayment: vi.fn(async () => {}), getCached: vi.fn(async () => null),
    getCachedAt: vi.fn(async () => null), setCached: vi.fn(async () => {}),
    saveQueryRun: vi.fn(async () => {}), discoverExternal: vi.fn(async () => []),
    decisionContext: vi.fn(async () => ({ sample: 0 })), saveMemory: vi.fn(async () => {}),
    notifyCitation: vi.fn(), alert: vi.fn(), activation: vi.fn(async () => {}),
  };
}

it("routes a complete collected run through explicit effects without public writes or shared cache/memory access", async () => {
  const question = "Confidential synthetic research marker";
  const queryId = `prv_${"a".repeat(64)}`;
  const sources = [makeSource({ id: "cached" }), makeSource({ id: "paid" })];
  const engine = fakeEngine({ decide: input => input.candidates.map(candidate => ({
    ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
    action: candidate.cached ? "CACHE" : "BUY",
  })) });
  const d = deps(sources, engine, fakeGateway());
  const forbidden = vi.fn(async () => { throw new Error("Public effect forbidden"); });
  for (const method of ["recordPayment", "getCached", "getCachedAt", "setCached", "saveQueryMemory", "loadQueryMemories",
    "getSourceNotify", "getSourceNotifyEmail", "recordActivationEvent", "saveQueryRun"] as const) {
    Object.assign(d.db, { [method]: forbidden });
  }
  d.discoverExternal = vi.fn(async () => { throw new Error("Legacy discovery forbidden"); });
  const effects = isolatedTestEffects(queryId);
  effects.getCachedAt = vi.fn(async key => key === "cached" ? new Date().toISOString() : null);
  effects.getCached = vi.fn(async () => "Scoped cached evidence.");
  const saveOrder: string[] = [];
  effects.saveQueryRun = vi.fn(async () => { saveOrder.push("save"); });
  const run = await collectRun({ question, queryId, budget: 0.05,
    onQueryRunSaveBoundary: async () => { saveOrder.push("boundary"); },
  }, { deps: { ...d, effects } });
  expect(run.question).toBe(question);
  expect(run.answer).not.toBe("");
  expect(run.totalSpent).toBeCloseTo(0.027, 6); // One toll + bounded citation pool, unchanged.
  expect(run.citations).toHaveLength(2);
  expect(forbidden).not.toHaveBeenCalled();
  expect(d.discoverExternal).not.toHaveBeenCalled();
  expect(effects.getCached).toHaveBeenCalledWith("cached");
  expect(effects.setCached).toHaveBeenCalledWith("paid", "content:paid.");
  expect(effects.recordPayment).toHaveBeenCalledTimes(3);
  expect(effects.discoverExternal).toHaveBeenCalledWith(question, expect.any(Array));
  expect(effects.decisionContext).toHaveBeenCalledWith(question, expect.any(Array));
  expect(effects.saveMemory).toHaveBeenCalledWith(queryId, question, expect.any(Array), expect.arrayContaining(["cached", "paid"]));
  expect(effects.notifyCitation).toHaveBeenCalledTimes(2);
  expect(effects.notifyCitation).toHaveBeenCalledWith(expect.objectContaining({ question, queryId }));
  expect(effects.saveQueryRun).toHaveBeenCalledWith(run);
  expect(saveOrder).toEqual(["boundary", "save"]);
});

it("refuses every incomplete explicit strategy before reasoning, funding or public fallback", async () => {
  const d = deps([makeSource({ id: "one" })], fakeEngine(), fakeGateway());
  const reason = vi.spyOn(d.engine, "decompose"), fund = vi.spyOn(d.gateway, "ensureFunded");
  for (const missing of Object.keys(isolatedTestEffects())) {
    const incomplete = { ...isolatedTestEffects() } as unknown as Record<string, unknown>;
    delete incomplete[missing];
    await expect(collectRun({ question: "Synthetic private input" }, {
      deps: { ...d, effects: incomplete as unknown as ResearchEffects },
    })).rejects.toThrow("Incomplete research effects strategy");
  }
  expect(reason).not.toHaveBeenCalled(); expect(fund).not.toHaveBeenCalled();
});

it("refuses reserved private IDs when a caller accidentally omits the effects strategy", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  const reason = vi.spyOn(d.engine, "decompose"), fund = vi.spyOn(d.gateway, "ensureFunded");
  const input = { question: "Synthetic private input", queryId: `prv_${"b".repeat(64)}` };
  await expect(collectRun(input, { deps: d })).rejects.toThrow("explicit effects strategy");
  await expect(drive(input, d)).rejects.toThrow("explicit effects strategy");
  expect(reason).not.toHaveBeenCalled(); expect(fund).not.toHaveBeenCalled();
});

it("keeps confirmed payment evidence in the answer when the selected ledger sink fails", async () => {
  const effects = isolatedTestEffects(`prv_${"c".repeat(64)}`);
  effects.recordPayment = vi.fn(async () => { throw new Error("Synthetic restricted ledger failure"); });
  const d = deps([makeSource({ id: "one" })], fakeEngine(), fakeGateway());
  const run = await collectRun({ question: "Synthetic private input", queryId: `prv_${"c".repeat(64)}`, budget: 0.05 }, { deps: { ...d, effects } });
  expect(run.answer).not.toBe("");
  expect(run.totalSpent).toBeCloseTo(0.027, 6);
  expect(effects.alert).toHaveBeenCalledWith("payment ledger write failed", expect.any(String));
  expect(d.db.payments).toEqual([]);
  expect(effects.saveQueryRun).toHaveBeenCalledWith(run);
});

it("rejects a complete public or different-job strategy for a private run before reasoning", async () => {
  const d = deps([], fakeEngine(), fakeGateway());
  const reason = vi.spyOn(d.engine, "decompose");
  const input = { question: "Synthetic private input", queryId: `prv_${"d".repeat(64)}` };
  await expect(collectRun(input, { deps: { ...d, effects: isolatedTestEffects() } })).rejects.toThrow("explicit effects strategy");
  await expect(collectRun(input, { deps: { ...d, effects: isolatedTestEffects(`prv_${"e".repeat(64)}`) } })).rejects.toThrow("another job");
  expect(reason).not.toHaveBeenCalled();
});

it("retains public collection and its persistence checkpoint when no strategy is supplied", async () => {
  const d = deps([makeSource({ id: "one" })], fakeEngine(), fakeGateway());
  const order: string[] = [];
  d.db.saveQueryRun = vi.fn(async () => { order.push("save"); });
  const run = await collectRun({ question: "Ordinary public research", queryId: "public-test", budget: 0.05,
    onQueryRunSaveBoundary: async () => { order.push("boundary"); },
  }, { deps: d });
  expect(d.db.saveQueryRun).toHaveBeenCalledWith(run);
  expect(d.db.payments).toHaveLength(2);
  expect(run.totalSpent).toBeCloseTo(0.027, 6);
  expect(order).toEqual(["boundary", "save"]);
});


it("keeps earned citation rewards while an incomplete final assessment lowers confidence", async () => {
  const totals: number[] = [];
  for (const sufficient of [true, false]) {
    const engine = fakeEngine({
      sufficiency: input => ({ sufficient: sufficient && input.gathered.length >= 2, rationale: "Synthetic final assessment",
        perClaim: input.subClaims.map(claim => ({ claim, coverage: 0.95, coveredBy: input.gathered.map(g => g.marker) })) }),
      synthesize: input => ({ answer: "The reported throughput is supported [S1] [S2].", citedMarkers: input.gathered.map(g => g.marker),
        evidence: input.gathered.map(g => ({ claimIndex: 0, marker: g.marker, quote: g.text, support: 0.95 })), conflicts: [] }),
    });
    const gateway = fakeGateway();
    const { run } = await drive({ question: "What throughput and latency were measured?", budget: 0.04 },
      deps([makeSource({ id: "alpha" }), makeSource({ id: "beta" })], engine, gateway));
    expect(run.confidence?.level).toBe("Low");
    expect(run.confidence?.reason).toContain("complete synthesis and per-assertion support remain unverified");
    expect(run.citations).toHaveLength(2); expect(gateway.citationCalls).toHaveLength(2);
    totals.push(run.totalSpent);
    if (!sufficient) {
      expect(run.answer).toContain("Low confidence");
      expect(run.confidence?.reason).toContain("final assessment");
    }
  }
  expect(totals[0]).toBe(totals[1]);
});

it("keeps valid citations while reported disagreement limits the final confidence", async () => {
  for (const trusted of ["none", "S1"]) {
    const sources = [makeSource({ id: "alpha" }), makeSource({ id: "beta" })];
    const engine = fakeEngine({
      sufficiency: input => ({ sufficient: input.gathered.length >= 2, rationale: "two positions available",
        perClaim: input.subClaims.map(claim => ({ claim, coverage: 0.95, coveredBy: input.gathered.map(g => g.marker) })) }),
      synthesize: input => ({ answer: "The sources disagree [S1] [S2].", citedMarkers: input.gathered.map(g => g.marker),
        evidence: input.gathered.map(g => ({ claimIndex: 0, marker: g.marker, quote: g.text, support: 0.95 })),
        conflicts: [{ point: "retention", positions: [{ marker: "S1", stance: "seven days" }, { marker: "S2", stance: "thirty days" }],
          trusted, reason: trusted === "none" ? "No precedence rule" : "More specific wording" }] }),
    });
    const gateway = fakeGateway();
    const { run } = await drive({ question: "Which retention period applies?", budget: 0.04 }, deps(sources, engine, gateway));
    expect(run.confidence?.level).toBe("Low");
    expect(run.citations).toHaveLength(2);
    expect(gateway.citationCalls).toHaveLength(2);
    if (trusted === "none") expect(run.answer).toContain("unresolved");
  }
});


function publicRef(id = "public:free"): PublicReference {
  return referenceSnapshot({ id, name: "Public publisher", url: "https://public.test", rssUrl: "https://public.test/feed",
    description: "Free public evidence", tags: ["agents"], active: true, items: [] }, {
    feedTitle: "Public", feedDescription: "Public", link: "https://public.test",
    items: [{ title: "Agent research", summary: "Useful agent evidence", content: "Public agents require honest evidence and source attribution.",
      link: `https://public.test/${id.replace(":", "-")}`, deliveryKind: "excerpt" }],
  });
}

describe("claim-managed free creator reading", () => {
  async function fixture(mode: "free" | "citation-only", ids = ["owned-free"]) {
    const oldOrigin = config.baseUrl;
    Object.assign(config, { baseUrl: "https://keryx.cc" });
    const proofTime = new Date(Date.now() - 1000).toISOString(), wallet = `0x${"11".repeat(20)}`;
    const sources = ids.map(id => makeSource({ id, fetchPrice: 0, url: `https://${id}.example/`, walletAddress: wallet,
      onchainId: `0x${"22".repeat(32)}`, sourceClaimId: id === ids[0] ? "a".repeat(64) : "b".repeat(64), verified: true }));
    const claims = new Map(sources.map(source => [source.id, { id: source.sourceClaimId!, canonicalUrl: source.url,
      ownerWallet: wallet, deploymentOrigin: new URL(config.baseUrl).origin, network: config.networkId, linkedSourceId: source.id,
      onchainId: source.onchainId, mode, distributionPermission: mode !== "free", revision: 3, effectiveAt: proofTime, verifiedAt: proofTime } as SourceClaim]));
    const items = Object.fromEntries(sources.map(source => [source.id, [{ id: `${source.id}-article`, sourceId: source.id,
      title: "Source evidence", summary: "Preview", content: `Measured evidence from ${source.id} supports the research question.`,
      link: `${source.url}article`, publishedAt: proofTime }]]));
    const gateway = fakeGateway(), engine = fakeEngine(), d = deps(sources, engine, gateway, { items });
    d.db.getSourceClaimForSource = async id => claims.get(id) ?? null;
    const terms = vi.spyOn(fetchAuthority, "sourceFetchTerms").mockImplementation(async source => ({
      payTo: source.walletAddress, creator: source.walletAddress, listPriceUsdc: 0, active: true, authority: "onchain", stale: false }));
    const restore = terms.mockRestore.bind(terms);
    terms.mockRestore = () => { Object.assign(config, { baseUrl: oldOrigin }); return restore(); };
    return { sources, items, claims, gateway, engine, d, terms };
  }
  it("reads verified free content without funding, x402, reward legs or fabricated payment records", async () => {
    const f = await fixture("free"), fund = vi.spyOn(f.gateway, "ensureFunded");
    try {
      const { run } = await drive({ question: "What was measured?", budget: 0.02, researchMode: "quick" }, f.d);
      expect(run.citations).toHaveLength(1);
      expect(run.citations[0]).toMatchObject({ reward: 0, accessKind: "creator-free", sourceClaim: sourceClaimReceipt(f.claims.get(f.sources[0].id)!) });
      expect(run.evidence?.[0]?.qualifiesForReward).toBe(false);
      expect(fund).not.toHaveBeenCalled(); expect(f.gateway.fetchCalls).toEqual([]); expect(f.gateway.citationCalls).toEqual([]);
      expect(f.d.db.payments).toEqual([]); expect(run.totalSpent).toBe(0);
    } finally { f.terms.mockRestore(); }
  });
  it("funds only an evidence-qualified citation reward after a citation-only free read", async () => {
    const f = await fixture("citation-only"), fund = vi.spyOn(f.gateway, "ensureFunded");
    try {
      const { run } = await drive({ question: "What was measured?", budget: 0.02, researchMode: "quick" }, f.d);
      expect(f.gateway.fetchCalls).toEqual([]); expect(fund).toHaveBeenCalledOnce();
      expect(f.gateway.citationCalls).toHaveLength(1); expect(f.d.db.payments.every(payment => payment.kind === "citation")).toBe(true);
      expect(run.citations[0].reward).toBeGreaterThan(0); expect(run.evidence?.[0]?.qualifiesForReward).toBe(true);
    } finally { f.terms.mockRestore(); }
  });
  it("retains the cited answer and reports one uncertain funding boundary across multiple free creators", async () => {
    const f = await fixture("citation-only", ["owned-free", "another-free"]), fund = vi.spyOn(f.gateway, "ensureFunded").mockRejectedValue(new Error("Gateway credit is unknown"));
    try {
      const { run } = await drive({ question: "What was measured?", budget: 0.02, researchMode: "quick" }, f.d);
      expect(run.citations).toHaveLength(2); expect(run.citations.every(citation => citation.reward === 0)).toBe(true);
      expect(fund).toHaveBeenCalledOnce(); expect(f.gateway.citationCalls).toEqual([]); expect(f.d.db.payments).toEqual([]);
      expect(run.answer).toContain("Funding readiness is unknown");
      expect(run.trace.some(step => step.message.includes("Funding readiness is unknown"))).toBe(true);
    } finally { f.terms.mockRestore(); }
  });
  it.each(["SKIP", "changed"])("preserves the original free public candidate when creator delivery is %s", async reason => {
    const f = await fixture("citation-only"), reference = publicRef();
    const article = f.items[f.sources[0].id][0]; article.content = reference.items[0].content; article.link = reference.items[0].link;
    f.d.db.listPublicReferences = async () => [reference];
    const engine = fakeEngine({ decide: input => {
      if (reason === "changed") f.claims.get(f.sources[0].id)!.revision++;
      return input.candidates.map(candidate => ({ ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
        action: candidate.sourceId === f.sources[0].id && reason === "SKIP" ? "SKIP" : "BUY" }));
    } });
    try {
      const { run } = await drive({ question: "What was measured?", budget: 0.02, researchMode: "quick" }, { ...f.d, engine });
      expect(run.citations).toHaveLength(1); expect(run.citations[0]).toMatchObject({ sourceId: reference.id, sourceKind: "public-reference", reward: 0 });
      expect(f.gateway.fetchCalls).toEqual([]); expect(f.gateway.citationCalls).toEqual([]);
    } finally { f.terms.mockRestore(); }
  });
});

describe("public feed references remain off the payment rail", () => {
  it("grounds public citations after a malicious BUY without gateway, cache or settlement rows", async () => {
    const gateway = fakeGateway();
    gateway.ensureFunded = async () => { throw new Error("Free-only research must never fund/deposit"); };
    const engine = fakeEngine({ decide: (input) => input.candidates.map((candidate) => ({
      ...buy({ id: candidate.id, name: candidate.name, price: 999 }),
      sourceKind: undefined, offerId: "forged-paid-offer", external: true,
    })) });
    const d = deps([], engine, gateway);
    d.db.listPublicReferences = async () => [publicRef()];
    d.db.getCached = async () => { throw new Error("A public read cannot trust forged paid cache data"); };
    const { run } = await drive({ question: "What evidence do agents need?", budget: 0.03, researchMode: "quick" }, d);
    expect(run.citations).toHaveLength(1);
    expect(run.citations[0]).toMatchObject({ sourceId: "public:free", sourceKind: "public-reference", reward: 0, publicDeliveryKind: "excerpt" });
    expect(run.citations[0].contentReceipt).toBeUndefined();
    expect(run.citations[0].contentVersion).toMatch(/^sha256:/);
    expect(run.evidence?.[0]).toMatchObject({ sourceKind: "public-reference", qualifiesForReward: false });
    expect(run.claimCoverage?.[0]?.coverage).toBe(0.9);
    expect(run.decisions[0]).toMatchObject({ action: "CACHE", price: 0, external: false, offerId: undefined });
    expect(run.paymentAttempts).toBe(0);
    expect(run.totalSpent).toBe(0);
    expect(d.db.payments).toEqual([]);
    expect(gateway.fetchCalls).toEqual([]);
    expect(gateway.citationCalls).toEqual([]);
  });

  it("retains paid 40%/10% shares and withholds public 50% without reallocating exact micros", async () => {
    const sources = [makeSource({ id: "owned-a" }), makeSource({ id: "owned-b" })];
    const gateway = fakeGateway();
    const engine = fakeEngine({
      decide: (input) => input.candidates.map((candidate) => ({
        ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
        targets: [candidate.id === "owned-a" ? 0 : candidate.id === "owned-b" ? 1 : 2],
      })),
      sufficiency: (input) => ({ sufficient: input.gathered.length === 3, rationale: "coverage",
        perClaim: input.subClaims.map((claim) => ({ claim, coverage: 0.9, coveredBy: input.gathered.map((g) => g.marker) })) }),
      attribute: (used) => used.map((item) => ({ sourceId: item.sourceId,
        weight: item.sourceId === "owned-a" ? 0.4 : item.sourceId === "owned-b" ? 0.1 : 0.5, rationale: "measured contribution" })),
    });
    engine.decompose = async () => ["owned evidence a", "owned evidence b", "public evidence"];
    const d = deps(sources, engine, gateway);
    d.db.listPublicReferences = async () => [publicRef()];
    const budget = 0.03;
    const { run } = await drive({ question: "Compare agent evidence", budget, executionLimits: { attentionLimit: 3, reevaluateRounds: 0 } }, d);
    expect(run.citations).toHaveLength(3);
    const poolMicros = Math.round(budget * config.citationPoolRatio * 1_000_000);
    expect(gateway.citationCalls.map((call) => [call.sourceId, Math.round(call.amount * 1_000_000)]))
      .toEqual([["owned-a", Math.round(poolMicros * 0.4)], ["owned-b", Math.round(poolMicros * 0.1)]]);
    expect(run.citations.find((citation) => citation.sourceId === "public:free")?.reward).toBe(0);
    expect(run.totalSpent).toBeLessThanOrEqual(budget);
    expect(gateway.fetchCalls).toEqual(["owned-a", "owned-b"]);
  });

  it("shares the attention cap with public reads and cannot promote model SKIP", async () => {
    const engine = fakeEngine({ decide: (input) => input.candidates.map((candidate, index) => ({
      ...buy({ id: candidate.id, name: candidate.name, price: 0 }), targets: [index % 2],
      action: candidate.id === "public:skipped" ? "SKIP" : "BUY",
    })) });
    engine.decompose = async () => ["first claim", "second claim"];
    const gateway = fakeGateway();
    const d = deps([], engine, gateway);
    d.db.listPublicReferences = async () => [publicRef("public:one"), publicRef("public:two"), publicRef("public:three"), publicRef("public:skipped")];
    const { run } = await drive({ question: "Agent evidence", budget: 0.01, researchMode: "quick" }, d);
    expect(run.evidencePortfolio?.outcome?.readAssetIds.length).toBeLessThanOrEqual(2);
    expect(run.decisions.find((decision) => decision.sourceId === "public:skipped")?.action).toBe("SKIP");
    expect(gateway.fetchCalls).toEqual([]);
    expect(gateway.citationCalls).toEqual([]);
  });
});


it("defers wallet funding until public-only research expansion admits an owned payable source", async () => {
  const source = makeSource({ id: "owned-later" });
  let expansionStarted = false;
  let fundingCalls = 0;
  const gateway = fakeGateway();
  gateway.ensureFunded = async () => {
    expect(expansionStarted).toBe(true);
    fundingCalls++;
    return { address: AGENT };
  };
  const engine = fakeEngine({
    decide: (input) => input.candidates.map((candidate) => ({
      ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
      action: candidate.id === "owned-later" ? "SKIP" : "BUY",
      targets: [candidate.id === "owned-later" ? 1 : 0],
    })),
    reevaluate: () => { expansionStarted = true; return { shouldBuyMore: true, recommendedIds: [source.id], rationale: "Owned evidence fills the gap" }; },
  });
  engine.decompose = async () => ["public evidence", "owned evidence"];
  const d = deps([source], engine, gateway);
  d.db.listPublicReferences = async () => [publicRef()];
  const { run } = await drive({ question: "Compare agent evidence", budget: 0.03,
    executionLimits: { attentionLimit: 2, reevaluateRounds: 1 } }, d);
  expect(fundingCalls).toBe(1);
  expect(gateway.fetchCalls).toEqual(["owned-later"]);
  expect(run.citations.find((citation) => citation.sourceId === "public:free")?.reward).toBe(0);
});

describe("funding uncertainty preserves public research", () => {
  it.each([ ["BUY", false], ["BUY", true], ["CACHE", false], ["CACHE", true] ] as const)(
    "withholds owned %s with publicFirst=%s and persists a supported public answer", async (action, publicFirst) => {
      const source = makeSource({ id: "owned-unavailable" });
      const gateway = fakeGateway(), fund = vi.spyOn(gateway, "ensureFunded").mockRejectedValue(new Error("PRIVATE funding diagnostic"));
      const boundary = vi.fn();
      const engine = fakeEngine({ decide: input => input.candidates.map(candidate => ({
        ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice },
          (candidate.id === "public:free") === publicFirst ? 0.95 : 0.6),
        action: candidate.id === "public:free" ? "BUY" : action,
        targets: [candidate.id === "public:free" ? 0 : 1],
      })) });
      engine.decompose = async () => ["public evidence", "owned evidence"];
      const d = deps([source], engine, gateway, action === "CACHE" ? { cachedAt: { [source.id]: new Date().toISOString() } } : {});
      d.db.listPublicReferences = async () => [publicRef()];
      const cache = vi.spyOn(d.db, "getCached"), save = vi.fn(); d.db.saveQueryRun = save;
      const run = await collectRun({ question: "Compare evidence", budget: 0.03, researchMode: "quick",
        onCreatorPaymentBoundary: boundary }, { deps: d });
      expect(run.evidencePortfolio?.selectedAssetIds[0]).toBe(publicFirst ? "public:free" : source.id);
      expect(fund).toHaveBeenCalledTimes(1); expect(boundary).not.toHaveBeenCalled();
      expect(cache).not.toHaveBeenCalled(); expect(gateway.fetchCalls).toEqual([]); expect(gateway.citationCalls).toEqual([]);
      expect(d.db.payments).toEqual([]); expect(run.paymentAttempts).toBe(0); expect(run.pendingPayments).toBe(0);
      expect(run.totalSpent).toBe(0); expect(run.totalSpent).toBeLessThanOrEqual(run.budget);
      expect(run.decisions.find(decision => decision.sourceId === source.id)).toMatchObject({ action: "SKIP", rationale: expect.stringContaining("unknown") });
      const published = run.trace.filter(step => step.phase === "decide" && (step.detail as Decision)?.sourceId === source.id);
      expect(published).toHaveLength(1);
      expect(published[0].message).toMatch(new RegExp(`^${action} `));
      expect(published[0].detail).toMatchObject({ action, rationale: expect.not.stringContaining("Funding readiness is unknown") });
      expect(published[0].detail).not.toBe(run.decisions.find(decision => decision.sourceId === source.id));
      expect(run.citations).toHaveLength(1); expect(run.citations[0]).toMatchObject({ sourceId: "public:free", reward: 0 });
      expect(run.evidence?.some(item => item.sourceKind === "public-reference" && item.qualifiesForAnswer)).toBe(true);
      expect(run.answer).toContain("“Public agents require honest evidence and source attribution.” [S1]"); expect(run.answer).toContain("wallet funding activity remains unverified");
      expect(run.trace.some(step => (step.detail as { fundingReadiness?: string } | undefined)?.fundingReadiness === "unknown")).toBe(true);
      expect(run.trace.some(step => step.message.startsWith(`SKIP ${source.name}`))).toBe(true);
      expect(run.trace.at(-1)?.message).toContain("Creator-payment amounts only");
      expect(JSON.stringify(run)).not.toContain("PRIVATE funding diagnostic"); expect(save).toHaveBeenCalledWith(run);
      expect(run.evidencePortfolio?.outcome?.readAssetIds).toEqual(["public:free"]);
    },
  );

  it.each(["pending", "settled"] as const)("does not turn a %s-looking funding error into a creator record or retry", async status => {
    const sources = [makeSource({ id: "owned-later-a" }), makeSource({ id: "owned-later-b" })];
    const gateway = fakeGateway();
    const payment = makePayment({ kind: "fetch", queryId: "synthetic-funding-error", sourceId: sources[0].id,
      sourceName: sources[0].name, payer: AGENT, payee: sources[0].walletAddress, amountUsdc: 0.002,
      settled: status === "settled", settlementStatus: status, ...(status === "settled" ? { txHash: "0xsynthetic" } : {}) });
    const error = status === "pending" ? new PaymentPendingError("PRIVATE funding state", payment) : new PaymentSettledError("PRIVATE funding state", payment);
    const fund = vi.spyOn(gateway, "ensureFunded").mockRejectedValue(error), boundary = vi.fn();
    const reeval = vi.fn((input: ReevaluateInput) => {
      if (reeval.mock.calls.length === 1) return { shouldBuyMore: true,
        recommendedIds: [sources[0].id, "public:extra", sources[1].id], rationale: "fill gaps" };
      expect(input.skippedSources.map(item => item.id)).toEqual(["public:remaining"]);
      return { shouldBuyMore: true, recommendedIds: [sources[0].id, "public:remaining", sources[1].id], rationale: "remaining free evidence" };
    });
    const engine = fakeEngine({ decide: input => input.candidates.map(candidate => ({
      ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
      action: candidate.id === "public:free" ? "BUY" : "SKIP",
    })), reevaluate: reeval });
    const d = deps(sources, engine, gateway); d.db.listPublicReferences = async () => [publicRef(), publicRef("public:extra"), publicRef("public:remaining")];
    const { run } = await drive({ question: "Evidence gaps", budget: 0.03,
      executionLimits: { attentionLimit: 4, reevaluateRounds: 2 }, onCreatorPaymentBoundary: boundary }, d);
    expect(reeval).toHaveBeenCalledTimes(2); expect(fund).toHaveBeenCalledTimes(1); expect(boundary).not.toHaveBeenCalled();
    expect(run.citations.map(item => item.sourceId)).toEqual(["public:free", "public:extra", "public:remaining"]);
    expect(run.decisions.filter(item => item.sourceId.startsWith("owned-")).every(item => item.action === "SKIP")).toBe(true);
    expect(gateway.fetchCalls).toEqual([]); expect(gateway.citationCalls).toEqual([]); expect(d.db.payments).toEqual([]);
    expect(run.paymentAttempts).toBe(0); expect(run.settledPayments).toBe(0); expect(run.pendingPayments).toBe(0); expect(run.pendingSpendUsdc).toBe(0);
    expect(run.answer).toContain("Funding readiness is unknown"); expect(JSON.stringify(run)).not.toContain("PRIVATE funding state");
  });

  it("retains the fetch reservation while permitting a bounded free public gap read", async () => {
    const budget = 0.03, source = makeSource({ id: "owned-full-budget", fetchPrice: fetchBudget(budget) });
    const gateway = fakeGateway(), fund = vi.spyOn(gateway, "ensureFunded").mockRejectedValue(new Error("unknown"));
    const engine = fakeEngine({ decide: input => input.candidates.map(candidate => ({
      ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
      action: candidate.id === "public:extra" ? "SKIP" : "BUY", targets: [candidate.id === source.id ? 1 : 0],
    })), reevaluate: input => { expect(input.remainingBudget).toBeCloseTo(0, 8);
      expect(input.skippedSources.map(item => item.id)).toEqual(["public:extra"]);
      return { shouldBuyMore: true, recommendedIds: [source.id, "public:extra"], rationale: "free gap evidence" }; } });
    engine.decompose = async () => ["public evidence", "owned evidence"];
    const d = deps([source], engine, gateway); d.db.listPublicReferences = async () => [publicRef(), publicRef("public:extra")];
    const { run } = await drive({ question: "Compare evidence", budget, executionLimits: { attentionLimit: 3, reevaluateRounds: 1 } }, d);
    expect(fund).toHaveBeenCalledTimes(1); expect(run.evidencePortfolio?.selectedBuyUsdc).toBeCloseTo(fetchBudget(budget), 8);
    expect(run.citations.map(item => item.sourceId)).toEqual(["public:free", "public:extra"]); expect(gateway.fetchCalls).toEqual([]);
  });

  it("distinguishes an owned-only funding outage from absence of relevant evidence", async () => {
    const gateway = fakeGateway(); vi.spyOn(gateway, "ensureFunded").mockRejectedValue(new Error("unknown"));
    const { run } = await drive({ question: "Owned evidence", budget: 0.03 }, deps([makeSource({ id: "owned" })], fakeEngine(), gateway));
    expect(run.answer).toContain("Funding readiness is unknown"); expect(run.answer).toContain("No supported answer");
    expect(run.decisions[0].action).toBe("SKIP"); expect(run.citations).toEqual([]); expect(run.paymentAttempts).toBe(0);
  });

  it.each([false, true])("propagates explicit funding abort during lazyExpansion=%s before more reasoning or persistence", async lazy => {
    const source = makeSource({ id: "owned" }), gateway = fakeGateway();
    const aborted = new DOMException("Synthetic user abort", "AbortError"); vi.spyOn(gateway, "ensureFunded").mockRejectedValue(aborted);
    const engine = fakeEngine({ decide: input => input.candidates.map(candidate => ({
      ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
      action: lazy && candidate.id === source.id ? "SKIP" : "BUY",
    })), reevaluate: () => ({ shouldBuyMore: true, recommendedIds: [source.id], rationale: "owned gap" }) });
    const synthesize = vi.spyOn(engine, "synthesize"), boundary = vi.fn(), d = deps([source], engine, gateway);
    d.db.listPublicReferences = async () => [publicRef()]; d.db.saveQueryRun = vi.fn();
    await expect(collectRun({ question: "Evidence", budget: 0.03, onCreatorPaymentBoundary: boundary,
      executionLimits: { attentionLimit: 2, reevaluateRounds: 1 } }, { deps: d })).rejects.toBe(aborted);
    expect(synthesize).not.toHaveBeenCalled(); expect(boundary).not.toHaveBeenCalled(); expect(d.db.saveQueryRun).not.toHaveBeenCalled();
    expect(gateway.fetchCalls).toEqual([]); expect(gateway.citationCalls).toEqual([]);
  });
});


describe("original public attention gate regression (#128)", () => {
  const question = "Compare original research on binding human approval to the exact action executed by stateful AI agents across proposal, approval, delay, execution and recovery. Seek Weng et al. arXiv 2606.02668v1, AgentSpec, and CAVA arXiv 2607.13716v1, plus directly relevant TOCTOU or stale-authorization work. Distinguish original paper text, abstract-only reads and metadata previews; compare action/argument binding, runtime state changes, expiry/replay and audit evidence. State coverage gaps rather than infer novelty.";
  it("uses the actual heuristic fallback on the representative multi-dimension question", async () => {
    const fallback = new HeuristicEngine();
    const engine = fakeEngine({ decide: undefined }); engine.decide = input => fallback.decide(input);
    engine.decompose = async () => [
      "What do Weng et al. arXiv 2606.02668v1, AgentSpec, and CAVA arXiv 2607.13716v1 each propose for binding human approval to the exact action executed by stateful AI agents across proposal, approval, delay, execution, and recovery?",
      "How do these sources and directly relevant TOCTOU or stale-authorization work compare on action/argument binding and runtime state changes?",
      "How do they compare on expiry/replay handling and audit evidence?",
      "What coverage gaps exist across these sources, distinguishing original paper text, abstract-only reads, and metadata previews?",
    ];
    const d = deps([], engine, fakeGateway());
    const candidate = scholarlyCandidate({ ...paper("2607.13716v1").item!.scholarly!, title: "CAVA: Canonical Action Verification and Attestation for Runtime Governance of Agentic AI Systems" });
    d.discoverScholarly = async () => ({ candidates: new Map([[candidate.id, candidate]]), succeeded: 1, unavailable: 0, requestedDois: 0, resolvedDois: 0 });
    d.readWebArticle = vi.fn(async url => ({ text: "Synthetic CAVA source evidence for the regression, not a real paper passage. Unfinished extraction tail", title: "Paper", finalUrl: url, kind: "pdf" as const, truncated: true }));
    const { run } = await drive({ question, origin: "web", researchMode: "deep" }, d);
    expect(run.decisions[0].expectedValue).toBeGreaterThanOrEqual(0.12); expect(run.decisions[0].expectedValue).toBeLessThan(0.45);
    expect(run.decisions[0].targets.length).toBeGreaterThan(0); expect(d.readWebArticle).toHaveBeenCalledTimes(1);
    expect(run.citations).toHaveLength(1); expect(run.totalSpent).toBe(0);
  });
  it.each([0.119, 0.12, 0.133, 0.183])("keeps raw preview EV %s and bounded positive-proposal admission", async expectedValue => {
    const gateway = fakeGateway();
    const d = deps([], fakeEngine({ decide: input => input.candidates.map(candidate => ({ ...buy({ id: candidate.id, name: candidate.name, price: 0 }, expectedValue), targets: [0] })) }), gateway);
    injectPapers(d, ["2607.13716v1"]);
    d.readWebArticle = vi.fn(async url => ({ text: "Synthetic original evidence binds approval to the exact action.", title: "Paper", finalUrl: url, kind: "pdf" as const, truncated: false }));
    const { run } = await drive({ question, origin: "web", researchMode: "deep" }, d);
    expect(run.decisions[0].expectedValue).toBe(expectedValue);
    expect(d.readWebArticle).toHaveBeenCalledTimes(expectedValue >= 0.12 ? 1 : 0);
    expect(run.citations).toHaveLength(expectedValue >= 0.12 ? 1 : 0);
    expect(gateway.fetchCalls).toEqual([]); expect(gateway.citationCalls).toEqual([]); expect(run.totalSpent).toBe(0);
    expect(run.answer).not.toBe("");
    if (expectedValue < 0.12) { expect(run.answer).toContain("attention gate"); expect(run.answer).toContain("larger source budget does not resolve"); }
  });
  it("cannot promote a model SKIP or a positive selection lacking a claim target", async () => {
    for (const invalid of [{ action: "SKIP" as const, targets: [0] }, { action: "BUY" as const, targets: [] }]) {
      const d = deps([], fakeEngine({ decide: input => input.candidates.map(candidate => ({ ...buy({ id: candidate.id, name: candidate.name, price: 0 }, 0.9), ...invalid })) }), fakeGateway());
      injectPapers(d); d.readWebArticle = vi.fn();
      const { run } = await drive({ question, origin: "web" }, d);
      expect(d.readWebArticle).not.toHaveBeenCalled(); expect(run.citations).toEqual([]);
    }
  });
  it("explains actual bounded original read failures without exposing transport internals", async () => {
    const d = deps([], fakeEngine(), fakeGateway()); injectPapers(d);
    d.readWebArticle = vi.fn(async () => { throw new Error("private internal transport details"); });
    const { run } = await drive({ question, origin: "web" }, d);
    expect(d.readWebArticle).toHaveBeenCalledTimes(2); expect(run.answer).toContain("Selected public originals");
    expect(run.answer).toContain("transport-unavailable"); expect(run.answer).not.toContain("private internal");
    expect(run.answer).toContain("Metadata previews are not read evidence"); expect(run.answer).not.toBe("");
    expect(run.citations).toEqual([]); expect(run.totalSpent).toBe(0);
  });
});


describe("research issue trust regressions", () => {
  it("excludes a new unmarked exact seed copy before any read or citation payment", async () => {
    const source = makeSource({ id: "new-source", name: "Fresh publisher" });
    const seed = SEED_SOURCES[0].items![0];
    const item: SourceItem = { ...seed, id: "new-item", sourceId: source.id, evidenceProvenance: undefined, bodyHash: contentBodyHash(seed.content) };
    const gateway = fakeGateway(), d = deps([source], fakeEngine(), gateway, { items: { [source.id]: [item] } });
    const { run } = await drive({ question: "Use original empirical research" }, d);
    expect(gateway.fetchCalls).toEqual([]); expect(gateway.citationCalls).toEqual([]);
    expect(run.citations).toEqual([]); expect(d.db.payments).toEqual([]);
  });
  it("fills a free Deep gap after a successful paid read exhausts exactly the fetch allocation", async () => {
    const source = makeSource({ id: "paid-first", fetchPrice: fetchBudget(0.03) });
    const gateway = fakeGateway();
    const reeval = vi.fn((input: ReevaluateInput) => {
      expect(input.remainingBudget).toBeCloseTo(0, 8);
      expect(input.skippedSources.map(candidate => [candidate.id, candidate.price])).toEqual([["public:free", 0]]);
      return { shouldBuyMore: true, recommendedIds: ["public:free", "paid-again"], rationale: "free gap read" };
    });
    const other = makeSource({ id: "paid-again", fetchPrice: 0.001 });
    const engine = fakeEngine({
      decide: input => input.candidates.map(candidate => ({ ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
        action: candidate.id === source.id ? "BUY" : "SKIP" })),
      sufficiency: () => ({ sufficient: false, rationale: "remaining gap", perClaim: [{ claim: "the sub-claim", coverage: 0.2, coveredBy: [] }] }),
      reevaluate: reeval,
    });
    const d = deps([source, other], engine, gateway); d.db.listPublicReferences = async () => [publicRef()];
    const { run } = await drive({ question: "Evidence gaps", budget: 0.03, researchMode: "deep",
      executionLimits: { attentionLimit: 2, reevaluateRounds: 1 } }, d);
    expect(reeval).toHaveBeenCalledTimes(1); expect(gateway.fetchCalls).toEqual([source.id]);
    expect(run.evidence?.map(item => item.sourceId)).toContain("public:free");
    expect(d.db.payments.filter(payment => payment.kind === "fetch").reduce((sum, payment) => sum + payment.amountUsdc, 0)).toBeCloseTo(fetchBudget(0.03), 8);
  });
  it("excludes a persisted synthetic benchmark and a mixed source's synthetic item from ordinary real research", async () => {
    const source = makeSource({ id: "renamed-publication", name: "Production research", evidenceProvenance: "synthetic-demo" });
    const mixed = makeSource({ id: "mixed-publication", name: "Unrelated name" });
    const item: SourceItem = { id: "11203a0e-e458-421d-9722-a6a243f1f779", sourceId: mixed.id,
      title: "Measuring x402 settlement latency on Arc", summary: "Synthetic latency fixture", link: "https://real-domain.test/article",
      content: "We measured median 178ms, p95 240ms", evidenceProvenance: "synthetic-demo" };
    const gateway = fakeGateway(), engine = fakeEngine();
    const d = deps([source, mixed], engine, gateway, { items: { [mixed.id]: [item] } });
    const { run } = await drive({ question: "What empirical Arc settlement latency was measured?" }, d);
    expect(gateway.fetchCalls).toEqual([]); expect(gateway.citationCalls).toEqual([]);
    expect(run.citations).toEqual([]); expect(run.answer).not.toContain("178ms"); expect(run.answer).not.toContain("240ms");
    expect(run.claimCoverage?.every(claim => claim.coverage === 0)).toBe(true);
  });
  it("retains explicitly offline demo citations and simulated rewards with illustrative labels and zero factual coverage", async () => {
    const source = makeSource({ id: "demo", evidenceProvenance: "synthetic-demo" });
    const item: SourceItem = { id: "fixture-demo", sourceId: source.id, title: "Authored benchmark pair", summary: "Illustrative benchmark",
      link: "https://fixture.test/article", content: "Illustrative measured median 178ms, p95 240ms; conflicting scenario is 900ms.", evidenceProvenance: "synthetic-demo" };
    const gateway = { ...fakeGateway(), mode: "offline" as const };
    const originalFetch = gateway.payFetch.bind(gateway), originalCitation = gateway.payCitation.bind(gateway);
    gateway.payFetch = async request => { const result = await originalFetch(request); return { ...result, payment: { ...result.payment, settled: false, settlementStatus: "simulated", txHash: null } }; };
    gateway.payCitation = async request => ({ ...await originalCitation(request), settled: false, settlementStatus: "simulated", txHash: null });
    const engine = fakeEngine({ synthesize: input => ({ answer: `${input.gathered[0].text} [S1]`, citedMarkers: ["S1"],
      evidence: [{ claimIndex: 0, marker: "S1", quote: input.gathered[0].text, support: 0.9 }] }) });
    const d = deps([source], engine, gateway, { items: { [source.id]: [item] } });
    const { run } = await drive({ question: "Illustrate demo settlements", budget: 0.03 }, d);
    expect(run.answer).toContain("Illustrative demo content"); expect(run.answer).toContain("178ms"); expect(run.answer).toContain("900ms");
    expect(run.citations[0]?.evidenceProvenance).toBe("synthetic-demo"); expect(gateway.citationCalls.length).toBeGreaterThan(0);
    expect(run.claimCoverage?.[0].coverage).toBe(0); expect(run.evidence?.[0].qualifiesForAnswer).toBe(false);
    expect(run.paymentMode).toBe("offline"); expect(d.db.payments.every(payment => payment.settlementStatus === "simulated")).toBe(true);
  });
});


it("retains a qualified paid excerpt and the exact existing citation allocation", async () => {
  const source = makeSource({ id: "qualified-paid", fetchPrice: 0.004 });
  const engine = fakeEngine({ synthesize: input => ({ answer: "Qualified paid draft [S1].", citedMarkers: ["S1"],
    evidence: [{ claimIndex: 0, marker: "S1", quote: input.gathered[0].text, support: 0.9 }] }) });
  const gateway = fakeGateway(), d = deps([source], engine, gateway);
  const { run } = await drive({ question: "Qualified paid question", budget: 0.03 }, d);
  expect(run.answer).not.toContain("Qualified paid draft");
  expect(run.answer).toContain("“content:qualified-paid.” [S1]");
  expect(run.citations).toHaveLength(1); expect(run.citations[0].reward).toBeCloseTo(0.03 * config.citationPoolRatio, 8);
  expect(d.db.payments.map(payment => [payment.kind, payment.amountUsdc])).toEqual([["fetch", 0.004], ["citation", 0.03 * config.citationPoolRatio]]);
  expect(run.totalSpent).toBeCloseTo(0.004 + 0.03 * config.citationPoolRatio, 8);
});

describe("omitted-assertion completion boundary", () => {
  it.each(["omitted-evaluation", "covered-targets", "covered-targets-vi", "no-proposals", "inflated-evaluation", "inflated-only", "multiline-methods"])("projects %s through finalization, attribution, history, receipts and exports", async variant => {
    const covered = variant.startsWith("covered-targets");
    const vietnamese = variant.endsWith("-vi");
    const sourceQuote = "The protocol binds approval to canonical action identity.";
    const quote = variant === "multiline-methods" ? sourceQuote.replace("approval to", "approval\nto") : sourceQuote;
    const evaluation = "The benchmark includes ten commands.";
    const unsupported = "All attacks are eliminated";
    const targets = ["Methods", "Evaluation"];
    const item: SourceItem = { id: "observed-item", sourceId: "owned-paper", title: "Observed article",
      link: "https://owned.example/article", summary: "Approval protocol and benchmark", content: `${sourceQuote} ${evaluation}` };
    const source = makeSource({ id: item.sourceId, fetchPrice: 0.004 });
    const engine = fakeEngine({
      sufficiency: input => ({ sufficient: covered, rationale: "Synthetic assessment",
        perClaim: input.subClaims.map((claim, index) => ({ claim,
          coverage: variant !== "no-proposals" && (index === 0 || covered || variant === "inflated-evaluation") ? 0.9 : 0,
          coveredBy: index === 0 || covered || variant === "inflated-evaluation" ? ["S1"] : [] })) }),
      synthesize: () => ({ answer: `The protocol binds approval [S1]. ${unsupported} [S1].`, citedMarkers: ["S1"],
        evidence: variant === "no-proposals" ? [] : [
          { claimIndex: 0, marker: "S1", quote: variant === "inflated-only" ? quote.replace("approval", `approval${" ".repeat(241)}`) : quote, support: 0.9 },
          ...(covered || variant === "inflated-evaluation" ? [{ claimIndex: 1, marker: "S1",
            quote: variant === "inflated-evaluation" ? evaluation.replace("includes", `includes${" ".repeat(241)}`) : evaluation, support: 0.9 }] : []),
        ] }),
    });
    engine.decompose = async () => targets;
    const attribution = vi.spyOn(engine, "attribute");
    const gateway = fakeGateway(), effects = isolatedTestEffects();
    const d = { ...deps([source], engine, gateway, { items: { [source.id]: [item] } }), effects };
    const run = await collectRun({ question: vietnamese ? "So sánh phương pháp và đánh giá, trả lời bằng tiếng Việt." : "Compare methods and evaluation", budget: 0.03,
      executionLimits: { attentionLimit: 1, reevaluateRounds: 0 } }, { deps: d });
    expect(run.answer).not.toContain(unsupported);
    expect(run.trace.some(step => JSON.stringify(step).includes(unsupported))).toBe(false);
    expect(effects.saveQueryRun).toHaveBeenCalledWith(run);
    expect(run.confidence?.level).toBe("Low");
    expect(run.confidence?.reason).toContain(vietnamese ? "chưa xác minh được tổng hợp đầy đủ" : "complete synthesis and per-assertion support remain unverified");
    if (vietnamese) {
      expect(run.answer).toContain("Độ tin cậy thấp");
      expect(run.answer).not.toContain("Low confidence");
      expect(run.trace.some(step => step.message.includes("Chỉ cung cấp trích đoạn nguồn đủ điều kiện"))).toBe(true);
    }
    expect(run.trace.some(step => (step.detail as { answerDelivery?: string })?.answerDelivery === "qualified-excerpts")).toBe(true);
    const supported = variant !== "no-proposals" && variant !== "inflated-only" && variant !== "multiline-methods";
    expect(run.citations).toHaveLength(supported ? 1 : 0);
    expect(gateway.citationCalls).toHaveLength(supported ? 1 : 0);
    expect(gateway.fetchCalls).toEqual([source.id]);
    expect(run.totalSpent).toBeCloseTo(0.004 + (supported ? 0.03 * config.citationPoolRatio : 0), 8);
    if (supported) {
      expect(run.answer).toContain(`“${sourceQuote}” [S1]`);
      expect(run.evidence?.[0].quote).toBe(quote);
      expect(run.citations[0]).toMatchObject({ itemId: item.id, itemUrl: item.link, contentVersion: sourceItemContentVersion(item) });
      expect(attribution).toHaveBeenCalledWith(expect.objectContaining({ answer: run.answer }));
      expect(run.answer.includes(evaluation)).toBe(covered);
    } else {
      expect(attribution).not.toHaveBeenCalled();
      expect(run.answer).toContain("No supported answer");
      expect(run.answer).not.toContain(quote);
    }
    const payments = vi.mocked(effects.recordPayment).mock.calls.map(([payment]) => payment);
    const receipt = buildResearchReceipt(run, payments);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    expect(receipt.payload.dispatch.answer).toBe(run.answer);
    expect(receipt.payload.claims[0]?.evidence[0]?.quote).toBe(supported ? quote : undefined);
    const report = researchReportMarkdown(run, null, payments);
    expect(report).toContain(run.answer);
    expect(report).not.toContain(unsupported);
    expect(buildAnswerContent(run)).toContain(run.answer);
    expect(buildAnswerContent(run)).not.toContain(unsupported);
    for (const result of [surfaceResearch(run), remoteResearchResult(run), keryxMeta(run),
      a2aResponseFromRun(run, quoteA2aResearch(0.03, "quick"))]) {
      expect(JSON.stringify(result)).not.toContain(unsupported);
      expect(result.researchExports.bibtex.count).toBe(supported ? 1 : 0);
      expect(result.researchExports.ris.count).toBe(supported ? 1 : 0);
      expect(result.researchExports.evidenceCsv.includes(quote)).toBe(supported);
      expect(result.evidence.map(item => item.quote)).toEqual(supported ? covered ? [quote, evaluation] : [quote] : []);
      expect(result.researchExports).toEqual(exportsFromCheckedReceipt(receipt));
    }
  });
});

/** Same frozen question, representative eight targets and synthetic provider/page responses. */
class SqliteSelectionFixture extends JsonChatEngine {
  readonly name = "llm:synthetic-sqlite-selection";
  constructor(private readonly allInvalid: boolean) { super(); }
  protected async chatJson(_model: string, _system: string, user: string) {
    this.recordUsage({ model: "synthetic", inputTokens: 100, cachedInputTokens: null, outputTokens: 20 });
    if (user.startsWith("User question (data):")) {
      return { status: "complete", claims: SQLITE_SELECTION_TARGETS, constraints: ["Use both exact originals, no paid sources."] };
    }
    const body = JSON.parse(user);
    if (Array.isArray(body.candidates)) {
      return { decisions: body.candidates.map((candidate: { sourceId: string; articleUrl?: string }, index: number) => {
        const original = candidate.articleUrl === "https://sqlite.org/wal.html" || candidate.articleUrl === "https://sqlite.org/backup.html";
        return { sourceId: candidate.sourceId, action: "CACHE", expectedValue: original ? 1 : 0.2,
          confidence: 0.8, rationale: "Synthetic predicted relevance; not document evidence.",
          ...(this.allInvalid ? {} : { targets: original ? (candidate.articleUrl?.endsWith("wal.html") ? [0, 1, 4, 7] : [2, 3, 5, 6, 7]) : [index === 2 ? 8 : -1] }) };
      }) };
    }
    if (body.schema.includes('"sufficient"')) return { sufficient: false, rationale: "Synthetic evidence is insufficient.",
      perClaim: SQLITE_SELECTION_TARGETS.map(claim => ({ claim, coverage: 0, coveredBy: [] })) };
    if (body.schema.includes('"citedMarkers"')) return { answer: "Synthetic fixture establishes no SQLite backup guarantee.",
      citedMarkers: [], evidence: [], conflicts: [] };
    return { weights: [] };
  }
}
function sqliteSelectionDeps(allInvalid: boolean) {
  const engine = new SqliteSelectionFixture(allInvalid), gateway = fakeGateway();
  const d = deps([], engine, gateway);
  d.webSearch = { search: vi.fn(async () => Array.from({ length: 8 }, (_, index) => ({
    title: `Synthetic SQLite preview ${index}`, url: `https://publisher-${index}.example/sqlite-backup`, snippet: "Synthetic preview only." }))) };
  d.readWebArticle = vi.fn(async url => ({ text: "Synthetic observed fixture text; no real snapshot or restore was tested.",
    title: "Synthetic original", finalUrl: url, kind: "html" as const, truncated: false }));
  return { d, engine, gateway };
}

it("keeps the frozen SQLite question and reads both supplied originals despite unrelated invalid mapping rows", async () => {
  expect(createHash("sha256").update(SQLITE_SELECTION_QUESTION).digest("hex")).toBe(SQLITE_SELECTION_QUESTION_SHA256);
  const { d, gateway } = sqliteSelectionDeps(false);
  const { run, steps } = await drive({ question: SQLITE_SELECTION_QUESTION, budget: 0, researchMode: "quick", origin: "web" }, d);
  expect(run.question).toBe(SQLITE_SELECTION_QUESTION);
  expect(run.subClaims).toEqual(SQLITE_SELECTION_TARGETS);
  expect(d.readWebArticle).toHaveBeenCalledTimes(2);
  expect(vi.mocked(d.readWebArticle!).mock.calls.map(call => call[0]).sort())
    .toEqual(["https://sqlite.org/backup.html", "https://sqlite.org/wal.html"]);
  const withheld = run.decisions.filter(item => item.selectionRefusal);
  expect(withheld).toHaveLength(8);
  expect(withheld.every(item => item.action === "SKIP" && item.targets.length === 0)).toBe(true);
  expect(steps.some(step => step.phase === "decide" && step.message.includes("Decision validation withheld"))).toBe(true);
  expect(run.trace.some(step => (step.detail as { protocol?: string } | undefined)?.protocol === "keryx-source-selection-v1")).toBe(true);
  expect(gateway.fetchCalls).toEqual([]); expect(gateway.citationCalls).toEqual([]);
  expect(run.citations).toEqual([]);
});

it("retains the classified SQLite failure and billed response counters without reading, paying or another model attempt", async () => {
  const { d, engine, gateway } = sqliteSelectionDeps(true);
  const steps: TraceStep[] = [];
  let error: unknown;
  try {
    for await (const step of runAgent({ question: SQLITE_SELECTION_QUESTION, budget: 0, researchMode: "quick", origin: "web" }, d)) steps.push(step);
  }
  catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(ResearchSelectionError);
  expect((error as ResearchSelectionError).diagnostic).toMatchObject({ outcome: "refused",
    counts: { targetCount: 8, validActionableCount: 0 }, reasons: expect.arrayContaining([expect.objectContaining({ code: "missing_targets" })]) });
  // Completed supplier responses remain separate from the application's rejected selection.
  expect(engine.calls).toHaveLength(2);
  expect(engine.calls.every(call => call.outcome === "returned")).toBe(true);
  expect(engine.usage).toHaveLength(2);
  expect(engine.usage.reduce((sum, item) => sum + item.inputTokens, 0)).toBe(200);
  expect(d.readWebArticle).not.toHaveBeenCalled();
  expect(gateway.fetchCalls).toEqual([]); expect(gateway.citationCalls).toEqual([]);
  expect(steps.at(-1)).toMatchObject({ phase: "decide", detail: { protocol: "keryx-source-selection-v1", outcome: "refused" } });
  expect(steps.some(step => step.phase === "done")).toBe(false);
});

describe("completed reads survive bounded model exhaustion", () => {
  it.each(["sufficiency", "reevaluate", "synthesize", "attribute"] as const)("retains the final dispatch and receipts after %s fails", async stage => {
    const sources = [makeSource({ id: "alpha" }), makeSource({ id: "beta" })];
    const engine = fakeEngine();
    engine[stage] = vi.fn(async () => { throw new Error("private-error allowance exhausted"); });
    if (stage === "reevaluate") {
      engine.decide = async input => input.candidates.map((candidate, index) => ({
        ...buy({ id: candidate.id, name: candidate.name, price: candidate.fetchPrice }),
        action: index === 0 ? "BUY" as const : "SKIP" as const,
      }));
      engine.sufficiency = async input => ({ sufficient: false, rationale: "gap", perClaim: input.subClaims.map(claim => ({ claim, coverage: 0.2, coveredBy: ["S1"] })) });
    }
    const gateway = fakeGateway();
    const d = deps(sources, engine, gateway);
    const { run, steps } = await drive({ question: "Assess the provided evidence", budget: 0.04, researchMode: "deep" }, d);
    expect(gateway.fetchCalls).toEqual(["alpha"]);
    expect(run.answer.length).toBeGreaterThan(0);
    expect(run.totalSpent).toBeGreaterThanOrEqual(0.002);
    expect(verifyResearchReceipt(buildResearchReceipt(run, d.db.payments)).valid).toBe(true);
    expect(JSON.stringify(steps)).not.toContain("private-error");
    if (stage === "attribute") {
      expect(gateway.citationCalls).toHaveLength(1);
      expect(run.citations[0].rationale).toContain("equal split");
    }
    if (stage === "synthesize" || stage === "sufficiency") expect(gateway.citationCalls).toHaveLength(0);
  });

  it("delivers the reviewed brief consistently across SSE, receipts and shared exports without private context or attribution prose", async () => {
    const engine = fakeEngine({ synthesize: input => {
      const sources = evidenceContext(input.question, input.subClaims, input.gathered);
      const options = buildContextualQuoteOptions(sources, input.gathered);
      const packet = prepareDecisionBrief(input, { facts: [{ id: "f1", targetIndex: 0,
        text: "The inspected fixture contains its alpha content.", quoteIds: [options[0].quoteId], support: 0.9 }], actions: [] }, options, sources)!;
      const decisionBrief = reviewDecisionBrief(packet, { digest: packet.digest,
        facts: [{ id: "f1", status: "supported", support: 0.8,
          quotes: [{ quoteId: options[0].quoteId, status: "supported", support: 0.8 }] }], actions: [] })!;
      return { answer: "[S1]", citedMarkers: ["S1"], evidence: briefEvidence(decisionBrief), decisionBrief, evidenceReview: "completed" };
    }, attribute: used => used.map(source => ({ sourceId: source.sourceId, weight: 1, rationale: "UNREVIEWED ATTRIBUTION ASSERTION" })) });
    const gateway = fakeGateway(); const d = deps([makeSource({ id: "alpha" })], engine, gateway);
    const { run, steps } = await drive({ question: "Inspect the fixture content", budget: 0.04 }, d);
    expect(run.answer).toContain("The inspected fixture contains its alpha content.");
    expect(steps.some(step => (step.detail as { answerDelivery?: string })?.answerDelivery === "reviewed-decision-brief")).toBe(true);
    expect(JSON.stringify(steps)).not.toContain("UNREVIEWED ATTRIBUTION ASSERTION");
    expect(JSON.stringify(steps)).not.toContain('"contextStart"');
    expect(gateway.citationCalls).toHaveLength(1);
    const receipt = buildResearchReceipt(run, d.db.payments);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    expect(receipt.payload.dispatch.answer).toBe(run.answer);
    expect(researchReportMarkdown(run, null, d.db.payments)).toContain(run.answer);
    expect(buildAnswerContent(run)).toContain(run.answer);
    for (const result of [surfaceResearch(run), remoteResearchResult(run), keryxMeta(run),
      a2aResponseFromRun(run, quoteA2aResearch(0.04, "quick"))]) {
      expect(JSON.stringify(result)).not.toContain("UNREVIEWED ATTRIBUTION ASSERTION");
      expect(result.researchExports).toEqual(exportsFromCheckedReceipt(receipt));
    }
  });
});
