import type { KeryxDB } from "../../db/keryx-db";
import type { ResearchEffects } from "../../agent/research-effects";
import type { GatheredContent } from "../../llm/reasoning-engine";
import type { Decision, PaymentRecord, QueryRun } from "../../types";
import { BUDGETS, PRICES, fixtureRows, microFromUsdc, usdcFromMicro, type StudyCorpus } from "./contract";
import { gradeTrial } from "./rubric";
import { assertStudyBoundary } from "./offline-boundary";

export interface StudyTrial {
  id: string; questionId: string; budgetMicro: string; paidPriceMicro: string;
  proposals: Decision[][]; reads: GatheredContent[]; payments: Omit<PaymentRecord, "id" | "createdAt">[];
  output: Omit<QueryRun, "createdAt" | "durationMs" | "trace">;
  trace: { phase: string; message: string; detail?: unknown }[];
  effects: Record<string, number>;
  metrics: ReturnType<typeof gradeTrial>;
}
export function assertSimulated(payment: PaymentRecord, queryId: string): void {
  if (payment.queryId !== queryId || payment.settled !== false || payment.settlementStatus !== "simulated"
    || payment.txHash !== null || payment.network !== "eip155:5042002" || !["fetch", "citation"].includes(payment.kind))
    throw new Error("Study refused a non-simulation payment");
  microFromUsdc(payment.amountUsdc);
}
export async function runStudy(corpus: StudyCorpus): Promise<StudyTrial[]> {
  // These imports occur only after the CLI worker establishes its offline/outbound boundary.
  assertStudyBoundary();
  const [{ SqliteAdapter }, { OfflineGateway }, { HeuristicEngine }, { runAgent }] = await Promise.all([
    import("../../db/sqlite-adapter"), import("../../payments/offline-gateway"),
    import("../../llm/heuristic-engine"), import("../../agent/run-agent"),
  ]);
  const trials: StudyTrial[] = [];
  for (const question of corpus.questions) for (const budgetMicro of BUDGETS) for (const paidPriceMicro of PRICES) {
    const id = `study-${question.id}-b${budgetMicro}-p${paidPriceMicro}`;
    const store = new SqliteAdapter(":memory:");
    const payments: PaymentRecord[] = [];
    const cache = new Map<string, string>();
    const counts: Record<string, number> = {};
    const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
    try {
      await store.init();
      for (const { source, item } of fixtureRows(question, paidPriceMicro)) {
        await store.upsertSource(source); await store.addItems([item]);
      }
      const allowed = new Set(["listSources", "getSource", "getItems", "getItem", "getArticleOffer", "getSourceClaimForSource"]);
      const db = new Proxy(store, { get(target, key) {
        if (typeof key !== "string" || !allowed.has(key)) { count("db.denied"); throw new Error(`Study denied database method ${String(key)}`); }
        const method = Reflect.get(target, key) as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => { count(`db.${key}`); return method.apply(target, args); };
      } }) as KeryxDB;
      const effects: ResearchEffects = {
        scope: { kind: "job", queryId: id },
        recordPayment: async payment => { assertSimulated(payment, id); payments.push(structuredClone(payment)); },
        getCached: async key => { count("cache.get"); return cache.get(key) ?? null; },
        getCachedAt: async () => null,
        setCached: async (key, body) => { count("cache.set"); cache.set(key, body); },
        saveQueryRun: async () => { throw new Error("Study does not persist query history"); },
        discoverExternal: async () => { count("discovery.disabled"); return []; },
        decisionContext: async () => ({ sample: 0 }),
        saveMemory: async () => { count("memory.isolated-noop"); },
        notifyCitation: () => { count("notification.isolated-noop"); },
        alert: () => { count("alert.isolated-noop"); },
        activation: async () => { count("activation.isolated-noop"); },
      };
      const engine = new HeuristicEngine();
      const proposals: Decision[][] = [];
      const reads = new Map<string, GatheredContent>();
      const observe = (gathered: GatheredContent[]) => { for (const read of gathered) reads.set(read.marker, structuredClone(read)); };
      const decide = engine.decide.bind(engine);
      engine.decide = async input => { const output = await decide(input); proposals.push(structuredClone(output)); return output; };
      const sufficiency = engine.sufficiency.bind(engine);
      engine.sufficiency = async input => { observe(input.gathered); return sufficiency(input); };
      const synthesize = engine.synthesize.bind(engine);
      engine.synthesize = async input => { observe(input.gathered); return synthesize(input); };
      const iterator = runAgent({ question: question.question, budget: usdcFromMicro(budgetMicro), queryId: id,
        origin: "engine", fundingOwner: "offline", researchMode: "deep", executionLimits: { attentionLimit: 4, reevaluateRounds: 1 } },
      { db, engine, gateway: new OfflineGateway(db), effects });
      let run: QueryRun;
      for (;;) { const step = await iterator.next(); if (step.done) { run = step.value; break; } }
      if (run.engine !== "heuristic" || run.paymentMode !== "offline" || run.fundingOwner !== "offline"
        || run.settledPayments !== 0 || run.pendingPayments !== 0 || (run.llmCalls?.length ?? 0) !== 0
        || (run.llmUsage?.length ?? 0) !== 0) throw new Error("Study runtime escaped fixed offline contract");
      const total = payments.reduce((sum, payment) => sum + microFromUsdc(payment.amountUsdc), 0n);
      if (total !== microFromUsdc(run.totalSpent) || total > BigInt(budgetMicro)
        || microFromUsdc(run.totalToCreators) !== total) throw new Error("Study accounting mismatch");
      const { createdAt: _createdAt, durationMs: _durationMs, trace, ...output } = run;
      const actualReads = [...reads.values()];
      if (counts["db.denied"]) throw new Error("Study attempted an undeclared database method");
      trials.push({ id, questionId: question.id, budgetMicro, paidPriceMicro, proposals, reads: actualReads,
        payments: payments.map(({ id: _id, createdAt: _at, ...payment }) => payment), output,
        trace: trace.map(step => ({ phase: step.phase, message: step.message, ...(step.detail === undefined ? {} : { detail: step.detail }) })),
        effects: counts, metrics: gradeTrial(question, run, actualReads, payments) });
    } finally { store.close(); }
  }
  return trials;
}
