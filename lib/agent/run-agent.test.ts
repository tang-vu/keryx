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
 *   5. external marketplace endpoints are always SKIP — never settled (off Keryx's Arc rail);
 *   6. unverified sources are off the money path (listed, but never discovered/read/cited/paid);
 *   7. a single toll failure degrades gracefully — the run still answers from what it read;
 *   8. a missing budget falls back to the configured default.
 *   9. a confirmed debit stays settled when post-payment content/acknowledgement delivery fails.
 *
 * The engine, DB, and gateway are injected as fakes, so these exercise the orchestrator's
 * deterministic control flow only — no LLM, no network, no chain.
 */

import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { runAgent, type RunInput } from "./run-agent";
import { config } from "../config";
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
          evidence: r.evidence ?? [],
        };
      }
      return {
        answer: `grounded answer ${input.gathered.map((g) => `[${g.marker}]`).join(" ")}`,
        citedMarkers: input.gathered.map((g) => g.marker),
        conflicts: [],
        evidence: input.gathered.map((g) => ({
          claimIndex: 0,
          marker: g.marker,
          quote: g.text,
          support: 0.9,
        })),
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
      return { content: item?.content || `content:${source.id}`, payment };
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
        ? `cached:${sourceId}`
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

// ── tests ───────────────────────────────────────────────────────────────────

describe("runAgent — money-safety invariants", () => {
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

  it("never settles to external marketplace endpoints — they are forced to SKIP", async () => {
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

    const { run } = await drive({ question: "q", budget }, d);

    const ext = run.decisions.find((x) => x.sourceId.startsWith("ext:"));
    expect(ext).toBeDefined();
    expect(ext!.action).toBe("SKIP");
    expect(ext!.external).toBe(true);
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
    expect(run.answer).toContain("remain pending");
    expect(d.db.payments).toHaveLength(1);
    expect(d.db.payments[0]).toMatchObject({
      settlementStatus: "pending",
      settled: false,
      authorizationId: "nonce-a",
    });
    expect(steps.some((step) => step.message.includes("confirmation is pending"))).toBe(true);
  });

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

    expect(run.answer).toContain("grounded answer");
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

    expect(run.answer).toContain("grounded answer");
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
  const cache = (id: string) => ({ [id]: "2026-07-20T00:00:00.000Z" });
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
      cachedByKey: { [cacheKey]: "2026-07-20T00:00:00.000Z" },
    });

    const { run } = await drive({ question: "q", budget: 0.05 }, d);

    expect(engine.decideInput?.candidates[0].cached).toBe(true);
    expect(run.decisions[0].action).toBe("CACHE");
    expect(gw.fetchCalls).toEqual([]);
    expect(d.db.payments.some((p) => p.kind === "fetch")).toBe(false);
    expect(run.citations.length).toBeGreaterThan(0); // a cached read still earns a citation reward
  });

  it("skips low-value cached content because free bytes still consume attention", async () => {
    const source = makeSource({ id: "a", fetchPrice: 0.004 });
    const engine = fakeEngine({
      decide: () => [{ ...cacheDecision("a"), expectedValue: 0.2 }],
    });
    const d = deps([source], engine, fakeGateway(), {
      cachedAt: cache("a"),
    });

    const { run } = await drive({ question: "q", budget: 0.05 }, d);

    expect(run.decisions[0]).toMatchObject({ action: "SKIP" });
    expect(run.decisions[0]?.rationale).toContain("attention gate");
    expect(run.citations).toEqual([]);
  });

  it("caps the synthesis context independently from the money budget", async () => {
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
      cachedAt: Object.fromEntries(sources.map((source) => [source.id, "2026-07-20T00:00:00.000Z"])),
    });

    const { run } = await drive({ question: "q", budget: 0.05 }, d);

    expect(run.decisions.filter((decision) => decision.action === "CACHE")).toHaveLength(
      config.maxAttentionSources,
    );
    expect(
      run.decisions.some(
        (decision) => decision.action === "SKIP" && decision.rationale.includes("attention budget is full"),
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
    expect(gw.fetchCalls).toHaveLength(config.maxAttentionSources);
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
