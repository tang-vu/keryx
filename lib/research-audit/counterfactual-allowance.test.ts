import { describe, expect, it, vi } from "vitest";
import { EvaluationAllowance, MAX_COUNTERFACTUAL_SAMPLE, planCounterfactualSample, runCounterfactualSample,
  type CounterfactualDecision, type EvaluationReservation } from "./counterfactual-allowance";

const skip = (id: string, price: number, extra: Partial<CounterfactualDecision> = {}): CounterfactualDecision =>
  ({ action: "SKIP", sourceId: `source-${id}`, itemId: `item-${id}`, contentVersion: "v1", price, ...extra });
const decisions: CounterfactualDecision[] = [
  { action: "BUY", sourceId: "source-bought", itemId: "item-bought", contentVersion: "v1", price: 0.004 },
  skip("a", 0.002), skip("b", 0.003), skip("c", 0.001), skip("d", 0.005),
  skip("bought", 0.004),                                   // the run also read this exact version
  skip("external", 0.001, { external: true }),            // discovery-only listing
  skip("legacy", 0.001, { contentVersion: undefined }),   // no exact identity
  skip("odd", 0.0000015),                                 // not a whole micro-USDC
];
const plan = (allowanceMicros: string, sampleLimit = 3, seed = "evaluation-2026-10") =>
  planCounterfactualSample({ runId: "run-1", seed, decisions, allowanceMicros, sampleLimit });

/** A payment rail with two separate ledgers. Only a matching capability can debit either one. */
function rail(userMicros: bigint) {
  const user = Object.freeze({ funding: "user-budget" });
  const state = { user: userMicros, userDebits: 0, evaluation: BigInt(0) };
  return { state, user, pay(capability: { funding: string }, amount: bigint) {
    if (capability === user) { state.user -= amount; state.userDebits++; }
    else if (capability.funding === "evaluation") state.evaluation += amount;
    else throw new Error("No capability");
  } };
}

describe("counterfactual evaluation allowance", () => {
  it("samples only unread exact-version skips inside the fixed allowance and sample limit", async () => {
    const chosen = await plan("1000000");
    expect(chosen).toMatchObject({ policy: "bounded-skip-sample-v1", eligibleSkips: 4, omittedForAllowance: 0, sampleLimit: 3 });
    expect(chosen.sample).toHaveLength(3);
    expect(chosen.sample.every(row => ["source-a", "source-b", "source-c", "source-d"].includes(row.sourceId))).toBe(true);
    // The order comes from the seed and identity, not from input order, price or predicted value.
    expect((await planCounterfactualSample({ runId: "run-1", seed: "evaluation-2026-10", decisions: [...decisions].reverse(),
      allowanceMicros: "1000000", sampleLimit: 3 })).sample).toEqual(chosen.sample);
    const tight = await plan("3000", MAX_COUNTERFACTUAL_SAMPLE);
    expect(BigInt(tight.plannedMicros)).toBeLessThanOrEqual(BigInt(3000));
    expect(tight.sample.length + tight.omittedForAllowance).toBe(4);
    expect((await plan("0")).sample).toEqual([]);
    const conflicting = await planCounterfactualSample({ runId: "run-1", seed: "s", allowanceMicros: "100000", sampleLimit: 3,
      decisions: [skip("a", 0.002), skip("a", 0.009)] });
    expect(conflicting).toMatchObject({ eligibleSkips: 0, sample: [] });
    for (const sampleLimit of [0, 1.5, MAX_COUNTERFACTUAL_SAMPLE + 1]) await expect(plan("1000", sampleLimit)).rejects.toThrow();
    for (const allowance of ["-1", "1.5", "", "1e3"]) await expect(plan(allowance)).rejects.toThrow();
  });

  it("cannot spend user budget: the reader only ever receives an evaluation reservation", async () => {
    for (const userBudget of [BigInt(0), BigInt(1), BigInt(50_000)]) {
      for (const allowanceMicros of ["0", "2500", "1000000"]) {
        const money = rail(userBudget), allowance = new EvaluationAllowance(allowanceMicros);
        const seen: EvaluationReservation[] = [];
        // Plan against a larger pool than the one supplied, so the runner itself must refuse the shortfall.
        const result = await runCounterfactualSample(await plan("1000000", MAX_COUNTERFACTUAL_SAMPLE), allowance, async (candidate, reservation) => {
          seen.push(reservation);
          money.pay(reservation, BigInt(candidate.quotedPriceMicros));
          return { chargedMicros: candidate.quotedPriceMicros };
        });
        expect(money.state.user).toBe(userBudget);
        expect(money.state.userDebits).toBe(0);
        expect(seen.every(reservation => reservation.funding === "evaluation" && Object.isFrozen(reservation))).toBe(true);
        expect(money.state.evaluation.toString()).toBe(result.evaluationConsumedMicros);
        expect(BigInt(result.evaluationConsumedMicros)).toBeLessThanOrEqual(BigInt(allowanceMicros));
        expect(result).toMatchObject({ funding: "evaluation-allowance", rewardEligible: false });
        expect(result.reads.filter(row => row.status === "allowance-exhausted").every(row => row.consumedMicros === "0")).toBe(true);
        expect(allowance.snapshot).toEqual({ totalMicros: allowanceMicros, consumedMicros: result.evaluationConsumedMicros,
          reservedMicros: "0", remainingMicros: (BigInt(allowanceMicros) - BigInt(result.evaluationConsumedMicros)).toString() });
        if (allowanceMicros === "0") expect(result.reads.every(row => row.status === "allowance-exhausted")).toBe(true);
      }
    }
  });

  it("never falls back to another budget when the allowance is exhausted or a read fails", async () => {
    const money = rail(BigInt(50_000)), allowance = new EvaluationAllowance("6000");
    let calls = 0;
    const result = await runCounterfactualSample(await plan("1000000", MAX_COUNTERFACTUAL_SAMPLE), allowance, async (candidate, reservation) => {
      if (calls++ === 0) throw new Error("source timed out after the payment was signed");
      money.pay(reservation, BigInt(candidate.quotedPriceMicros));
      return { chargedMicros: candidate.quotedPriceMicros };
    });
    // The failed read keeps its reservation consumed: an error cannot prove that no money moved.
    expect(result.reads[0]).toMatchObject({ status: "failed", consumedMicros: result.reads[0].quotedPriceMicros });
    expect(BigInt(allowance.snapshot.consumedMicros)).toBeLessThanOrEqual(BigInt(6000));
    expect(allowance.snapshot.consumedMicros).toBe(result.evaluationConsumedMicros);
    expect(money.state).toMatchObject({ user: BigInt(50_000), userDebits: 0 });
    expect(result.reads.some(row => row.status === "allowance-exhausted")).toBe(true);
  });

  it("refuses overcharges, reused or foreign reservations and has no top-up", async () => {
    const allowance = new EvaluationAllowance("5000");
    await expect(runCounterfactualSample(await plan("1000000", 1), allowance, async candidate =>
      ({ chargedMicros: (BigInt(candidate.quotedPriceMicros) + BigInt(1)).toString() }))).rejects.toThrow("exceeds its reservation");
    const afterOvercharge = allowance.snapshot;
    expect(afterOvercharge.reservedMicros).toBe("0");
    expect(BigInt(afterOvercharge.consumedMicros) + BigInt(afterOvercharge.remainingMicros)).toBe(BigInt(5000));
    const pool = new EvaluationAllowance("1000"), reservation = pool.reserve("600")!;
    expect(pool.reserve("600")).toBeNull();
    pool.settle(reservation, "400");
    expect(() => pool.settle(reservation, "100")).toThrow();
    expect(() => pool.settle({ funding: "evaluation", reservedMicros: "600" }, "100")).toThrow();
    expect(() => new EvaluationAllowance("1000").forfeit(reservation)).toThrow();
    expect(pool.snapshot).toEqual({ totalMicros: "1000", consumedMicros: "400", reservedMicros: "0", remainingMicros: "600" });
    expect(Object.getOwnPropertyNames(EvaluationAllowance.prototype).sort()).toEqual(["constructor", "forfeit", "reserve", "settle", "snapshot"]);
    const forged = { policy: "bounded-skip-sample-v1", runId: "run-1", sample: [] } as never;
    await expect(runCounterfactualSample(forged, { reserve: () => ({ funding: "evaluation", reservedMicros: "1" }) } as never,
      async () => ({ chargedMicros: "0" }))).rejects.toThrow();
  });

  it("validates the entire declared sample before any reader and rejects a larger funding pool", async () => {
    const chosen = await plan("1000000", 3);
    const reader = vi.fn(async (row: { quotedPriceMicros: string }) => ({ chargedMicros: row.quotedPriceMicros }));
    for (const changed of [
      { ...chosen, plannedMicros: "0" }, { ...chosen, allowanceMicros: "1" },
      { ...chosen, sampleLimit: 1 }, { ...chosen, eligibleSkips: 0 },
      { ...chosen, omittedForAllowance: 10 }, { ...chosen, userBudget: "10000" },
      { ...chosen, sample: [chosen.sample[0], chosen.sample[0]], plannedMicros: (BigInt(chosen.sample[0].quotedPriceMicros) * BigInt(2)).toString() },
      { ...chosen, sample: [...chosen.sample.slice(0, 2), { ...chosen.sample[2], quotedPriceMicros: "-1" }] },
    ]) await expect(runCounterfactualSample(changed, new EvaluationAllowance("1000000"), reader)).rejects.toThrow();
    await expect(runCounterfactualSample(chosen, new EvaluationAllowance("1000001"), reader)).rejects.toThrow();
    const sparse = structuredClone(chosen); delete sparse.sample[1];
    const accessor = structuredClone(chosen);
    Object.defineProperty(accessor.sample, "1", { get: () => chosen.sample[1], enumerable: true });
    for (const malformed of [sparse, accessor])
      await expect(runCounterfactualSample(malformed, new EvaluationAllowance("1000000"), reader)).rejects.toThrow();
    expect(reader).not.toHaveBeenCalled();
    expect(() => { (new EvaluationAllowance("1") as { totalMicros: string }).totalMicros = "1000000"; }).toThrow();
  });

  it("keeps the validated sample fixed while an asynchronous reader mutates caller data", async () => {
    const chosen = await plan("1000000", 3), retained = structuredClone(chosen);
    const result = await runCounterfactualSample(chosen, new EvaluationAllowance("1000000"), async (candidate) => {
      chosen.runId = "changed-run";
      chosen.sample[1].sourceId = "changed-source";
      chosen.sample[2].quotedPriceMicros = "900000";
      chosen.sample.push({ ...candidate, sourceId: "extra-source" });
      await Promise.resolve();
      return { chargedMicros: candidate.quotedPriceMicros };
    });
    expect(result.runId).toBe(retained.runId);
    expect(result.reads.map(({ status: _status, consumedMicros: _cost, ...row }) => row)).toEqual(retained.sample);
    expect(result.evaluationConsumedMicros).toBe(retained.plannedMicros);
  });
});
