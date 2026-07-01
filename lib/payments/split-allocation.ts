/**
 * Exact split allocation for multi-author citation rewards.
 *
 * A reward is split across author wallets by weight. Rounding each author's share independently
 * (`round(reward * weight)`) lets the legs sum to slightly less/more than the reward — a per-payout
 * micro-USDC drift that accumulates over thousands of settlements. This allocates in integer
 * micro-USDC (USDC's 6-decimal settlement unit) using the largest-remainder method, so the legs
 * ALWAYS sum back to exactly the reward regardless of the (float) weights. Weights are normalized
 * by their own sum, so basis-point-derived weights that sum to 0.9999999 still allocate exactly.
 */

const MICROS = 1e6;

/**
 * Split `totalUsdc` across `weights`, returning one USDC amount per weight. The returned amounts
 * sum to exactly `round(totalUsdc, 6)`. Zero/negative total or all-zero weights → all zeros.
 */
export function allocateSplit(totalUsdc: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const totalMicros = Math.round(totalUsdc * MICROS);
  const clamped = weights.map((w) => (w > 0 ? w : 0));
  const weightSum = clamped.reduce((s, w) => s + w, 0);
  if (totalMicros <= 0 || weightSum <= 0) return weights.map(() => 0);

  // Ideal (fractional) micro share per author, then floor and hand out the leftover micros to the
  // largest fractional parts first — guarantees Σ(floors)+leftover === totalMicros.
  const ideal = clamped.map((w) => (w / weightSum) * totalMicros);
  const micros = ideal.map((x) => Math.floor(x));
  let leftover = totalMicros - micros.reduce((s, m) => s + m, 0);

  const byFrac = ideal
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; leftover > 0; k++, leftover--) micros[byFrac[k % n].i] += 1;

  return micros.map((m) => m / MICROS);
}
