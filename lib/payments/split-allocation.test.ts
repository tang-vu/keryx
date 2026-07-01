/**
 * Exact-allocation tests. The core guarantee: however the reward is split, the legs sum back to
 * EXACTLY the reward in micro-USDC — the property that eliminates per-payout settlement drift.
 */

import { describe, it, expect } from "vitest";
import { allocateSplit } from "./split-allocation";

const micros = (n: number) => Math.round(n * 1e6);

describe("allocateSplit — exact multi-author reward split", () => {
  it("legs sum to exactly the reward for an even 3-way split (where naive rounding drifts)", () => {
    const reward = 0.01;
    const legs = allocateSplit(reward, [1 / 3, 1 / 3, 1 / 3]);
    // Naive round(reward*weight) would give 0.003333 × 3 = 0.009999 — a micro short. This is exact.
    expect(legs.reduce((s, x) => s + micros(x), 0)).toBe(micros(reward));
    expect(legs.length).toBe(3);
  });

  it("respects the weighting (60/40) and stays exact", () => {
    const legs = allocateSplit(0.025, [0.6, 0.4]);
    expect(legs).toEqual([0.015, 0.01]);
    expect(legs.reduce((s, x) => s + micros(x), 0)).toBe(micros(0.025));
  });

  it("normalizes weights that don't sum to 1 (basis-point float slop)", () => {
    const legs = allocateSplit(0.03, [0.3333, 0.3333, 0.3333]); // sums to 0.9999
    expect(legs.reduce((s, x) => s + micros(x), 0)).toBe(micros(0.03));
  });

  it("hands a single-author reward entirely to that author", () => {
    expect(allocateSplit(0.0123, [1])).toEqual([0.0123]);
  });

  it("hands leftover micros to the largest fractional parts first", () => {
    // 7 micros over weights 0.5/0.3/0.2 → ideal 3.5/2.1/1.4 → floors 3/2/1 (=6), 1 leftover micro
    // goes to the largest frac (0.5) → 4/2/1.
    const legs = allocateSplit(0.000007, [0.5, 0.3, 0.2]).map(micros);
    expect(legs).toEqual([4, 2, 1]);
    expect(legs.reduce((s, x) => s + x, 0)).toBe(7);
  });

  it("returns zeros for a zero reward or all-zero weights", () => {
    expect(allocateSplit(0, [0.5, 0.5])).toEqual([0, 0]);
    expect(allocateSplit(0.01, [0, 0])).toEqual([0, 0]);
    expect(allocateSplit(0.01, [])).toEqual([]);
  });
});
