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
 *
 * The engine, DB, and gateway are injected as fakes, so these exercise the orchestrator's
 * deterministic control flow only — no LLM, no network, no chain.
 */

import { describe, it, expect } from "vitest";
import { runAgent, type RunInput } from "./run-agent";
import { config } from "../config";
import { makePayment, type PaymentGateway } from "../payments/payment-gateway";
import type { AgentDeps } from "./deps";
import type { KeryxDB } from "../db/keryx-db";
import type {
  DecideInput,
  ReevaluateInput,
  ReasoningEngine,
  SufficiencyInput,
  SynthInput,
} from "../llm/reasoning-engine";
import type { Author, Decision, PaymentRecord, QueryRun, Source, TraceStep } from "../types";

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
  sufficiency?: (input: SufficiencyInput) => { sufficient: boolean; rationale: string };
  reevaluate?: (input: ReevaluateInput) => {
    shouldBuyMore: boolean;
    recommendedIds: string[];
    rationale: string;
  };
  synthesize?: (input: SynthInput) => { answer: string; citedMarkers: string[] };
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
      const r = (over.sufficiency ?? (() => ({ sufficient: true, rationale: "enough read" })))(input);
      return { ...r, perClaim: [] };
    },
    async reevaluate(input: ReevaluateInput) {
      const r = (over.reevaluate ?? (() => ({ shouldBuyMore: false, recommendedIds: [], rationale: "no gaps" })))(input);
      return { claims: [], ...r };
    },
    async synthesize(input: SynthInput) {
      const r = (over.synthesize ?? ((i) => ({ answer: "grounded answer", citedMarkers: i.gathered.map((g) => g.marker) })))(input);
      return { ...r, conflicts: [] };
    },
    async attribute(input: { used: { sourceId: string }[] }) {
      return (over.attribute ?? ((used) => used.map((u) => ({ sourceId: u.sourceId, weight: 1 / used.length, rationale: "equal" }))))(input.used);
    },
  };
  return self as unknown as ReasoningEngine & { decideInput?: DecideInput };
}

interface FakeGateway extends PaymentGateway {
  fetchCalls: string[];
  citationCalls: { sourceId: string; payee: string; amount: number }[];
}

/** A gateway that always settles. `failOn` makes payFetch throw for a given source id. */
function fakeGateway(opts: { failOn?: string } = {}): FakeGateway {
  const gw: FakeGateway = {
    mode: "real",
    fetchCalls: [],
    citationCalls: [],
    agentAddress: () => AGENT,
    async ensureFunded() {
      return { address: AGENT };
    },
    async payFetch({ source, queryId }) {
      if (opts.failOn === source.id) throw new Error("settlement failed");
      gw.fetchCalls.push(source.id);
      const payment = makePayment({
        kind: "fetch",
        queryId,
        sourceId: source.id,
        sourceName: source.name,
        payer: AGENT,
        payee: source.walletAddress,
        amountUsdc: source.fetchPrice,
        settled: true,
        txHash: "0xfetch",
      });
      return { content: `content:${source.id}`, payment };
    },
    async payCitation({ source, author, amount, weight, queryId, rationale }) {
      gw.citationCalls.push({ sourceId: source.id, payee: author.walletAddress, amount });
      return makePayment({
        kind: "citation",
        queryId,
        sourceId: source.id,
        sourceName: source.name,
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

/** A KeryxDB that serves the given sources and records payments. Only the methods the
 *  orchestrator (and its best-effort memory/notify helpers) touch are implemented. */
function fakeDb(sources: Source[]): KeryxDB & { payments: PaymentRecord[] } {
  const payments: PaymentRecord[] = [];
  const db = {
    payments,
    async listSources() {
      return sources;
    },
    async getItems() {
      return [];
    },
    async getCached() {
      return null;
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

function deps(sources: Source[], engine: ReasoningEngine, gateway: PaymentGateway): AgentDeps & {
  db: KeryxDB & { payments: PaymentRecord[] };
} {
  const db = fakeDb(sources);
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

    const { run } = await drive({ question: "q", budget }, d);

    expect(run.totalToCreators).toBe(run.totalSpent);
    expect(run.totalSpent).toBeGreaterThan(0);
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

  it("falls back to the configured default budget when none is provided", async () => {
    const sources = [makeSource({ id: "a", fetchPrice: 0.004 })];
    const d = deps(sources, fakeEngine(), fakeGateway());

    const { run } = await drive({ question: "q" }, d); // no budget

    expect(run.budget).toBe(config.defaultBudget);
  });
});

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
